import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell } from '@ton/core';
import { CocoonProxy } from '../wrappers/CocoonProxy';
import { CocoonParams, cocoonParamsToCell } from '../wrappers/CocoonRoot';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair } from '@ton/crypto';
import { TestKeyPairs, TestConstants, createDefaultParams, closeProxyFully } from './helpers/fixtures';
import { assertExcessesSent } from './helpers/fixtures';

describe('CocoonProxy - Comprehensive (Part 1: State Transitions & Signed Messages)', () => {
    let code: Cell;
    let workerCode: Cell;
    let clientCode: Cell;
    let keyPair: KeyPair;
    let defaultParams: Cell;

    beforeAll(async () => {
        code = await compile('CocoonProxy');
        workerCode = await compile('CocoonWorker');
        clientCode = await compile('CocoonClient');
        keyPair = TestKeyPairs.PROXY_KEYPAIR;

        const configParams: CocoonParams = {
            ...createDefaultParams(),
            proxy_delay_before_close: 7200,
            worker_sc_code: workerCode,
            client_sc_code: clientCode,
        };

        defaultParams = cocoonParamsToCell(configParams);
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let root: SandboxContract<TreasuryContract>;
    let attacker: SandboxContract<TreasuryContract>;
    let cocoonProxy: SandboxContract<CocoonProxy>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        root = await blockchain.treasury('root');
        attacker = await blockchain.treasury('attacker');

        cocoonProxy = blockchain.openContract(
            CocoonProxy.createFromConfig(
                {
                    ownerAddress: owner.address,
                    proxyPublicKey: BigInt('0x' + keyPair.publicKey.toString('hex')),
                    rootAddress: root.address,
                    state: TestConstants.STATE_NORMAL,
                    balance: 0n,
                    stake: toNano('1'),
                    unlockTs: 0,
                    params: defaultParams,
                },
                code
            )
        );

        const deployResult = await cocoonProxy.sendDeploy(deployer.getSender(), toNano('5'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonProxy.address,
            deploy: true,
            success: true,
        });
    });

    describe('State Transitions via Text Commands', () => {
        describe('Text "c" - Close', () => {
            it('should transition NORMAL → CLOSING', async () => {
                const dataBefore = await cocoonProxy.getData();
                expect(dataBefore.state).toBe(TestConstants.STATE_NORMAL);

                const result = await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: true,
                });
                expect(await cocoonProxy.getData()).toMatchObject({
                    state: TestConstants.STATE_CLOSING,
                });
            });

            it('should allow withdraw in CLOSING state (balance only, no state change)', async () => {
                // First close → CLOSING
                await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                expect(await cocoonProxy.getData()).toMatchObject({
                    state: TestConstants.STATE_CLOSING,
                });

                // Withdraw takes balance but stays in CLOSING
                const result = await cocoonProxy.sendTextWithdraw(owner.getSender(), toNano('0.1'));

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: true,
                });

                // Still CLOSING, balance withdrawn
                expect(await cocoonProxy.getData()).toMatchObject({
                    state: TestConstants.STATE_CLOSING,
                    balance: 0n,
                });
            });

            it('should reject text close from CLOSING state', async () => {
                // First close → CLOSING
                await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                // Try text close again - should fail (text "c" only works from NORMAL)
                const result = await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });

            it('should reject close from CLOSED state', async () => {
                // Close fully
                await closeProxyFully(cocoonProxy, owner, blockchain, keyPair);

                // Try to close from CLOSED
                const result = await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });

            it('should reject close from non-owner', async () => {
                const result = await cocoonProxy.sendTextClose(
                    attacker.getSender(),
                    toNano('0.1')
                );

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
                });
            });

            it('should reject close with low value', async () => {
                const result = await cocoonProxy.sendTextClose(
                    owner.getSender(),
                    toNano('0.002')
                );

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_LOW_MSG_VALUE,
                });
            });
        });

        describe('Text "w" - Withdraw', () => {
            it('should withdraw balance successfully', async () => {
                // Need to somehow add balance first (in real scenario, would come from worker payouts)
                // For test purposes, we'll just verify the mechanism works
                const result = await cocoonProxy.sendTextWithdraw(owner.getSender(), toNano('0.1'));

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: true,
                });

                expect(await cocoonProxy.getData()).toMatchObject({ balance: 0n });
            });

            it('should reject withdraw from non-owner', async () => {
                const result = await cocoonProxy.sendTextWithdraw(
                    attacker.getSender(),
                    toNano('0.1')
                );

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
                });
            });

            it('should reject withdraw if already closed', async () => {
                // Close fully
                await closeProxyFully(cocoonProxy, owner, blockchain, keyPair);

                expect(await cocoonProxy.getData()).toMatchObject({
                    state: TestConstants.STATE_CLOSED,
                });

                // Try to withdraw from CLOSED
                const result = await cocoonProxy.sendTextWithdraw(owner.getSender(), toNano('0.1'));

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });
        });

        describe('Unknown text command', () => {
            it('should reject unknown text command', async () => {
                const result = await owner.send({
                    to: cocoonProxy.address,
                    value: toNano('0.1'),
                    body: beginCell()
                        .storeUint(0, 32) // op = 0
                        .storeUint(120, 8) // "x" - invalid
                        .endCell(),
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_UNKNOWN_TEXT_OP,
                });
            });
        });
    });

    describe('Owner Proxy Close Message', () => {
        it('should close via owner message', async () => {
            const result = await cocoonProxy.sendOwnerProxyClose(owner.getSender(), {
                value: toNano('0.1'),
                sendExcessesTo: owner.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: true,
            });
            assertExcessesSent(result, owner.address);

            const data = await cocoonProxy.getData();
            expect(data.state).toBe(TestConstants.STATE_CLOSING);
            expect(data.unlockTs).toBeGreaterThan(0);
        });

        it('should reject close from non-owner', async () => {
            const result = await cocoonProxy.sendOwnerProxyClose(attacker.getSender(), {
                value: toNano('0.1'),
                sendExcessesTo: attacker.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: attacker.address,
                to: cocoonProxy.address,
                success: false,
                exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
            });
        });

        it('should reject close if not in NORMAL state', async () => {
            // Close to CLOSING state
            await cocoonProxy.sendOwnerProxyClose(owner.getSender(), {
                value: toNano('0.1'),
                sendExcessesTo: owner.address,
            });

            // Try to close again
            const result = await cocoonProxy.sendOwnerProxyClose(owner.getSender(), {
                value: toNano('0.1'),
                sendExcessesTo: owner.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });
        });
    });

    describe('Signed Messages', () => {
        describe('ExtProxyCloseRequestSigned (0x636a4391)', () => {
            it('should close from NORMAL with valid signature', async () => {
                const result = await cocoonProxy.sendCloseRequest(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: true,
                });
            });

            it('should reject with bad signature', async () => {
                const result = await cocoonProxy.sendCloseRequest(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair: TestKeyPairs.WRONG_KEYPAIR,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_BAD_SIGNATURE,
                });
            });

            it('should reject with wrong expected address', async () => {
                const result = await cocoonProxy.sendCloseRequest(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair,
                    expectedAddress: attacker.address, // Wrong address
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MY_ADDRESS,
                });
            });

            it('should reject if not in NORMAL state', async () => {
                // First close to CLOSING
                await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                // Try signed close request
                const result = await cocoonProxy.sendCloseRequest(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });
        });

        describe('ExtProxyCloseCompleteRequestSigned (0xe511abc7)', () => {
            it('should complete close from CLOSING with valid signature', async () => {
                // First go to CLOSING state
                await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                // Advance time
                blockchain.now = Math.floor(Date.now() / 1000) + 7300;

                // Complete close with signed message
                const result = await cocoonProxy.sendCloseComplete(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: true,
                });

                expect(await cocoonProxy.getData()).toMatchObject({
                    state: TestConstants.STATE_CLOSED,
                    balance: 0n,
                    stake: 0n,
                });
            });

            it('should reject with bad signature', async () => {
                // Go to CLOSING first
                await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));
                blockchain.now = Math.floor(Date.now() / 1000) + 7300;

                const result = await cocoonProxy.sendCloseComplete(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair: TestKeyPairs.WRONG_KEYPAIR,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_BAD_SIGNATURE,
                });
            });

            it('should reject if not in CLOSING state', async () => {
                // Try from NORMAL state
                const result = await cocoonProxy.sendCloseComplete(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });

            it('should reject if not unlocked yet', async () => {
                // Go to CLOSING state
                await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                // Try to complete close immediately (not unlocked)
                const result = await cocoonProxy.sendCloseComplete(owner.getSender(), {
                    value: toNano('0.2'),
                    sendExcessesTo: owner.address,
                    keyPair,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_NOT_UNLOCKED_YET,
                });
            });
        });
    });

    describe('External Messages', () => {
        describe('ExtProxyPayoutRequest', () => {
            it('should payout balance', async () => {
                const result = await cocoonProxy.sendExtProxyPayoutRequest(owner.getSender(), {
                    value: toNano('0.1'),
                    sendExcessesTo: owner.address,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: true,
                });

                expect(await cocoonProxy.getData()).toMatchObject({ balance: 0n });
            });

            it('should reject payout if closed', async () => {
                // Close fully
                await closeProxyFully(cocoonProxy, owner, blockchain, keyPair);

                // Try payout
                const result = await cocoonProxy.sendExtProxyPayoutRequest(owner.getSender(), {
                    value: toNano('0.1'),
                    sendExcessesTo: owner.address,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });
        });

        describe('ExtProxyIncreaseStake', () => {
            it('should increase stake', async () => {
                const dataBefore = await cocoonProxy.getData();

                const result = await cocoonProxy.sendExtProxyIncreaseStake(owner.getSender(), {
                    value: toNano('2'),
                    grams: toNano('1'),
                    sendExcessesTo: owner.address,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: true,
                });

                const dataAfter = await cocoonProxy.getData();
                expect(dataAfter.stake).toBe(dataBefore.stake + toNano('1'));
            });

            it('should reject increase stake if closed', async () => {
                // Close fully
                await closeProxyFully(cocoonProxy, owner, blockchain, keyPair);

                // Try increase stake
                const result = await cocoonProxy.sendExtProxyIncreaseStake(owner.getSender(), {
                    value: toNano('2'),
                    grams: toNano('1'),
                    sendExcessesTo: owner.address,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });

            it('should reject with low value', async () => {
                const result = await cocoonProxy.sendExtProxyIncreaseStake(owner.getSender(), {
                    value: toNano('0.5'), // Less than grams + COMMISSION
                    grams: toNano('1'),
                    sendExcessesTo: owner.address,
                });

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_LOW_MSG_VALUE,
                });
            });
        });
    });

    describe('Edge Cases', () => {
        it('should ignore empty messages', async () => {
            const result = await owner.send({
                to: cocoonProxy.address,
                value: toNano('0.1'),
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: true,
            });
        });

        it('should ignore OP_DO_NOT_PROCESS messages', async () => {
            const result = await owner.send({
                to: cocoonProxy.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(TestConstants.OP_DO_NOT_PROCESS, 32).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: true,
            });
        });

        it('should reject unknown opcode', async () => {
            const result = await owner.send({
                to: cocoonProxy.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(0x99999999, 32).storeUint(0, 64).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: false,
            });
        });
    });
});

