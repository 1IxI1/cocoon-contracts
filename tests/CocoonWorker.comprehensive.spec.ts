import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { CocoonWorker } from '../wrappers/CocoonWorker';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair } from '@ton/crypto';
import { TestKeyPairs, createParamsCell, TestConstants } from './helpers/fixtures';

describe('CocoonWorker - Comprehensive', () => {
    let code: Cell;
    let keyPair: KeyPair;
    let defaultParams: Cell;

    beforeAll(async () => {
        code = await compile('CocoonWorker');
        keyPair = TestKeyPairs.PROXY_KEYPAIR;
        defaultParams = createParamsCell();
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let proxy: SandboxContract<TreasuryContract>;
    let attacker: SandboxContract<TreasuryContract>;
    let cocoonWorker: SandboxContract<CocoonWorker>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        proxy = await blockchain.treasury('proxy');
        attacker = await blockchain.treasury('attacker');

        cocoonWorker = blockchain.openContract(
            CocoonWorker.createFromConfig(
                {
                    ownerAddress: owner.address,
                    proxyAddress: proxy.address,
                    proxyPublicKey: BigInt('0x' + Buffer.from(keyPair.publicKey).toString('hex')),
                    params: defaultParams,
                },
                code,
            ),
        );

        const deployResult = await cocoonWorker.sendDeploy(deployer.getSender(), toNano('0.5'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonWorker.address,
            deploy: true,
            success: true,
        });
    });

    describe('Common Patterns', () => {
        it('should reject messages with low value', async () => {
            // Use OwnerWorkerRegister as the test message
            const result = await cocoonWorker.sendRegister(owner.getSender(), owner.address, toNano('0.001'));

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonWorker.address,
                success: false,
                exitCode: TestConstants.ERROR_LOW_MSG_VALUE,
            });
        });

        it('should reject OwnerWorkerRegister from non-owner', async () => {
            const result = await cocoonWorker.sendRegister(attacker.getSender(), owner.address, toNano('0.15'));

            expect(result.transactions).toHaveTransaction({
                from: attacker.address,
                to: cocoonWorker.address,
                success: false,
                exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
            });
        });
    });

    describe('Signed Payout Messages', () => {
        describe('PayoutRequest (0xa040ad28)', () => {
            it('should accept valid payout and send WorkerProxyRequest', async () => {
                const queryId = 123;
                const newTokens = 1000n;

                const result = await cocoonWorker.sendPayoutRequest(
                    owner.getSender(),
                    queryId,
                    newTokens,
                    cocoonWorker.address,
                    owner.address,
                    keyPair,
                    toNano('0.2'),
                );

                expect(result.transactions).toHaveTransaction({
                    to: cocoonWorker.address,
                    success: true,
                });

                // Verify WorkerProxyRequest sent to proxy
                expect(result.transactions).toHaveTransaction({
                    from: cocoonWorker.address,
                    to: proxy.address,
                    op: TestConstants.OP_WORKER_PROXY_REQUEST,
                    success: true,
                });

                // Verify tokens updated
                const data = await cocoonWorker.getData();
                expect(data.tokens).toBe(newTokens);
                expect(data.state).toBe(TestConstants.STATE_NORMAL); // Still normal
            });

            it('should reject payout with bad signature', async () => {
                const wrongKeyPair = TestKeyPairs.WRONG_KEYPAIR;

                const result = await cocoonWorker.sendPayoutRequest(
                    owner.getSender(),
                    123,
                    1000n,
                    cocoonWorker.address,
                    owner.address,
                    wrongKeyPair,
                    toNano('0.2'),
                );

                expect(result.transactions).toHaveTransaction({
                    to: cocoonWorker.address,
                    success: false,
                    exitCode: TestConstants.ERROR_BAD_SIGNATURE,
                });
            });

            it('should reject payout with old tokens (same count)', async () => {
                // First payout
                await cocoonWorker.sendPayoutRequest(
                    owner.getSender(),
                    123,
                    1000n,
                    cocoonWorker.address,
                    owner.address,
                    keyPair,
                    toNano('0.2'),
                );

                // Try same token count again
                const result = await cocoonWorker.sendPayoutRequest(
                    owner.getSender(),
                    124,
                    1000n,
                    cocoonWorker.address,
                    owner.address,
                    keyPair,
                    toNano('0.2'),
                );

                expect(result.transactions).toHaveTransaction({
                    to: cocoonWorker.address,
                    success: false,
                    exitCode: TestConstants.ERROR_OLD_MESSAGE,
                });
            });

            it('should reject payout with wrong expected address', async () => {
                const result = await cocoonWorker.sendPayoutRequest(
                    owner.getSender(),
                    123,
                    1000n,
                    attacker.address,
                    owner.address,
                    keyPair,
                    toNano('0.2'),
                );

                expect(result.transactions).toHaveTransaction({
                    to: cocoonWorker.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MY_ADDRESS,
                });
            });
        });

        describe('LastPayoutRequest (0xf5f26a36)', () => {
            it('should accept last payout and close worker', async () => {
                const queryId = 456;
                const newTokens = 2000n;

                const result = await cocoonWorker.sendLastPayoutRequest(
                    owner.getSender(),
                    queryId,
                    newTokens,
                    cocoonWorker.address,
                    owner.address,
                    keyPair,
                    toNano('0.2'),
                );

                expect(result.transactions).toHaveTransaction({
                    to: cocoonWorker.address,
                    success: true,
                });

                // Verify WorkerProxyRequest sent
                expect(result.transactions).toHaveTransaction({
                    from: cocoonWorker.address,
                    to: proxy.address,
                    op: TestConstants.OP_WORKER_PROXY_REQUEST,
                    success: true,
                });

                // Verify worker closed
                const data = await cocoonWorker.getData();
                expect(data.tokens).toBe(newTokens);
                expect(data.state).toBe(TestConstants.STATE_CLOSED);
            });

            it('should reject last payout with bad signature', async () => {
                const wrongKeyPair = TestKeyPairs.WRONG_KEYPAIR;

                const result = await cocoonWorker.sendLastPayoutRequest(
                    owner.getSender(),
                    456,
                    2000n,
                    cocoonWorker.address,
                    owner.address,
                    wrongKeyPair,
                    toNano('0.2'),
                );

                expect(result.transactions).toHaveTransaction({
                    to: cocoonWorker.address,
                    success: false,
                    exitCode: TestConstants.ERROR_BAD_SIGNATURE,
                });
            });

            it('should reject last payout with old tokens (tokens > newTokens)', async () => {
                // First payout to 1000 tokens
                await cocoonWorker.sendPayoutRequest(
                    owner.getSender(),
                    123,
                    1000n,
                    cocoonWorker.address,
                    owner.address,
                    keyPair,
                    toNano('0.2'),
                );

                // Try last payout with lower count
                const result = await cocoonWorker.sendLastPayoutRequest(
                    owner.getSender(),
                    124,
                    500n, // Lower than current
                    cocoonWorker.address,
                    owner.address,
                    keyPair,
                    toNano('0.2'),
                );

                expect(result.transactions).toHaveTransaction({
                    to: cocoonWorker.address,
                    success: false,
                    exitCode: TestConstants.ERROR_OLD_MESSAGE,
                });
            });
        });
    });

    describe('OwnerWorkerRegister Message', () => {
        it('should register with proxy', async () => {
            const result = await cocoonWorker.sendRegister(owner.getSender(), owner.address, toNano('0.15'));

            expect(result.transactions).toHaveTransaction({
                to: cocoonWorker.address,
                success: true,
            });

            // Verify WorkerProxyRequest sent
            expect(result.transactions).toHaveTransaction({
                from: cocoonWorker.address,
                to: proxy.address,
                op: TestConstants.OP_WORKER_PROXY_REQUEST,
                // success=false, proxy is fake
            });
        });

        it('should reject register from non-owner', async () => {
            const result = await cocoonWorker.sendRegister(attacker.getSender(), owner.address, toNano('0.15'));

            expect(result.transactions).toHaveTransaction({
                from: attacker.address,
                to: cocoonWorker.address,
                success: false,
                exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
            });
        });
    });

    describe('Closed State Handling', () => {
        let closedWorker: SandboxContract<CocoonWorker>;

        beforeEach(async () => {
            // Create worker and close it
            closedWorker = blockchain.openContract(
                CocoonWorker.createFromConfig(
                    {
                        ownerAddress: owner.address,
                        proxyAddress: proxy.address,
                        proxyPublicKey: BigInt('0x' + Buffer.from(keyPair.publicKey).toString('hex')),
                        params: defaultParams,
                    },
                    code,
                ),
            );

            await closedWorker.sendDeploy(deployer.getSender(), toNano('0.5'));

            // Send last payout to close it
            await closedWorker.sendLastPayoutRequest(
                owner.getSender(),
                0,
                1000n,
                closedWorker.address,
                owner.address,
                keyPair,
                toNano('0.2'),
            );
        });

        it('should reject all messages when closed', async () => {
            // Try register
            const registerResult = await closedWorker.sendRegister(owner.getSender(), owner.address, toNano('0.15'));

            expect(registerResult.transactions).toHaveTransaction({
                from: owner.address,
                to: closedWorker.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });

            // Try payout
            const payoutResult = await closedWorker.sendPayoutRequest(
                owner.getSender(),
                0,
                2000n,
                closedWorker.address,
                owner.address,
                keyPair,
                toNano('0.2'),
            );

            expect(payoutResult.transactions).toHaveTransaction({
                from: owner.address,
                to: closedWorker.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });
        });
    });

    describe('Getters', () => {
        it('should return correct get_cocoon_worker_data', async () => {
            const data = await cocoonWorker.getData();

            // Verify all 5 fields
            expect(data.ownerAddress.toString()).toBe(owner.address.toString());
            expect(data.proxyAddress.toString()).toBe(proxy.address.toString());
            expect(data.proxyPublicKey).toBe(BigInt('0x' + Buffer.from(keyPair.publicKey).toString('hex')));
            expect(data.state).toBe(TestConstants.STATE_NORMAL);
            expect(data.tokens).toBe(0n);
        });

        it('should reflect state changes in getter', async () => {
            // Send payout
            await cocoonWorker.sendPayoutRequest(
                owner.getSender(),
                0,
                500n,
                cocoonWorker.address,
                owner.address,
                keyPair,
                toNano('0.2'),
            );

            const data = await cocoonWorker.getData();
            expect(data.tokens).toBe(500n);
            expect(data.state).toBe(TestConstants.STATE_NORMAL);
        });
    });

    describe('Edge Cases', () => {
        it('should ignore empty messages', async () => {
            const result = await owner.send({
                to: cocoonWorker.address,
                value: toNano('0.1'),
            });

            expect(result.transactions).toHaveTransaction({
                to: cocoonWorker.address,
                success: true,
            });
        });

        it('should ignore OP_DO_NOT_PROCESS', async () => {
            const result = await owner.send({
                to: cocoonWorker.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(TestConstants.OP_DO_NOT_PROCESS, 32).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                to: cocoonWorker.address,
                success: true,
            });
        });

        it('should reject unknown opcode', async () => {
            const result = await owner.send({
                to: cocoonWorker.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(0x99999999, 32).storeUint(0, 64).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                to: cocoonWorker.address,
                success: false,
            });
        });
    });
});
