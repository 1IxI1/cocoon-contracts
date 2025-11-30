import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { CocoonClient, CocoonClientConfig } from '../wrappers/CocoonClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair } from '@ton/crypto';
import { TestKeyPairs, createParamsCell, TestConstants } from './helpers/fixtures';

describe('CocoonClient - Comprehensive (Part 2: State Transitions & Getters)', () => {
    let code: Cell;
    let keyPair: KeyPair;

    beforeAll(async () => {
        code = await compile('CocoonClient');
        keyPair = TestKeyPairs.PROXY_KEYPAIR;
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let proxy: SandboxContract<TreasuryContract>;
    let attacker: SandboxContract<TreasuryContract>;
    let cocoonClient: SandboxContract<CocoonClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        proxy = await blockchain.treasury('proxy');
        attacker = await blockchain.treasury('attacker');

        const config: CocoonClientConfig = {
            ownerAddress: owner.address,
            proxyAddress: proxy.address,
            proxyPublicKey: BigInt('0x' + keyPair.publicKey.toString('hex')),
            state: TestConstants.STATE_NORMAL,
            balance: toNano('10'),
            stake: toNano('1'),
            tokensUsed: 0n,
            unlockTs: 0,
            secretHash: 0n,
            params: createParamsCell({
                client_delay_before_close: 3600, // 1 hour
            }),
        };

        cocoonClient = blockchain.openContract(CocoonClient.createFromConfig(config, code));

        const deployResult = await cocoonClient.sendDeploy(deployer.getSender(), toNano('15'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonClient.address,
            deploy: true,
            success: true,
        });
    });

    describe('State Transitions - OwnerClientRequestRefund', () => {
        it('should transition NORMAL → CLOSING with excess withdrawal', async () => {
            // Client has balance = 10 TON, stake = 1 TON
            const dataBefore = await cocoonClient.getData();
            expect(dataBefore.state).toBe(TestConstants.STATE_NORMAL);
            expect(dataBefore.balance).toBe(toNano('10'));

            const result = await cocoonClient.sendOwnerRequestRefund(
                owner.getSender(),
                toNano('0.15'),
                owner.address
            );

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonClient.address,
                success: true,
            });

            const dataAfter = await cocoonClient.getData();
            expect(dataAfter.state).toBe(TestConstants.STATE_CLOSING);
            expect(dataAfter.unlockTs).toBeGreaterThan(0);
            expect(dataAfter.balance).toBe(toNano('1')); // Reduced to stake

            // Verify refund message sent
            expect(result.transactions).toHaveTransaction({
                from: cocoonClient.address,
                to: proxy.address,
                op: TestConstants.OP_CLIENT_PROXY_REQUEST,
                success: true,
            });
        });

        it('should transition NORMAL → CLOSING without excess (balance = stake)', async () => {
            // Create client with balance = stake
            const config: CocoonClientConfig = {
                ownerAddress: owner.address,
                proxyAddress: proxy.address,
                proxyPublicKey: BigInt('0x' + keyPair.publicKey.toString('hex')),
                state: TestConstants.STATE_NORMAL,
                balance: toNano('1'), // Equal to stake
                stake: toNano('1'),
                tokensUsed: 0n,
                unlockTs: 0,
                secretHash: 0n,
                params: createParamsCell({ client_delay_before_close: 3600 }),
            };

            const equalBalanceClient = blockchain.openContract(CocoonClient.createFromConfig(config, code));
            await equalBalanceClient.sendDeploy(deployer.getSender(), toNano('5'));

            const result = await equalBalanceClient.sendOwnerRequestRefund(
                owner.getSender(),
                toNano('0.15'),
                owner.address
            );

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: equalBalanceClient.address,
                success: true,
            });

            const data = await equalBalanceClient.getData();
            expect(data.state).toBe(TestConstants.STATE_CLOSING);
            expect(data.balance).toBe(toNano('1')); // Unchanged
        });

        it('should transition CLOSING → CLOSED when unlocked', async () => {
            // First, go to CLOSING state
            await cocoonClient.sendOwnerRequestRefund(owner.getSender(), toNano('0.15'), owner.address);

            const dataBefore = await cocoonClient.getData();
            expect(dataBefore.state).toBe(TestConstants.STATE_CLOSING);

            // Advance time past unlock
            blockchain.now = Math.floor(Date.now() / 1000) + 3700;

            // Request refund again
            const result = await cocoonClient.sendOwnerRequestRefund(
                owner.getSender(),
                toNano('0.15'),
                owner.address
            );

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonClient.address,
                success: true,
            });
        });

        it('should reject CLOSING → CLOSED before unlock', async () => {
            // First, go to CLOSING state
            await cocoonClient.sendOwnerRequestRefund(owner.getSender(), toNano('0.15'), owner.address);

            // Try to close immediately
            const result = await cocoonClient.sendOwnerRequestRefund(
                owner.getSender(),
                toNano('0.15'),
                owner.address
            );

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonClient.address,
                success: false,
                exitCode: TestConstants.ERROR_NOT_UNLOCKED_YET,
            });
        });

        it('should reject request from CLOSED state', async () => {
            // Create closed client
            const config: CocoonClientConfig = {
                ownerAddress: owner.address,
                proxyAddress: proxy.address,
                proxyPublicKey: BigInt('0x' + keyPair.publicKey.toString('hex')),
                state: TestConstants.STATE_CLOSED,
                balance: toNano('10'),
                stake: toNano('1'),
                tokensUsed: 0n,
                unlockTs: 0,
                secretHash: 0n,
                params: createParamsCell(),
            };

            const closedClient = blockchain.openContract(CocoonClient.createFromConfig(config, code));
            await closedClient.sendDeploy(deployer.getSender(), toNano('15'));

            const result = await closedClient.sendOwnerRequestRefund(
                owner.getSender(),
                toNano('0.15'),
                owner.address
            );

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: closedClient.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });
        });

        it('should reject refund request from non-owner', async () => {
            const result = await cocoonClient.sendOwnerRequestRefund(
                attacker.getSender(),
                toNano('0.15'),
                attacker.address
            );

            expect(result.transactions).toHaveTransaction({
                from: attacker.address,
                to: cocoonClient.address,
                success: false,
                exitCode: TestConstants.ERROR_EXPECTED_OWNER,
            });
        });
    });

    describe('State Transition Flows', () => {
        it('should complete full lifecycle: NORMAL → CLOSING → CLOSED', async () => {
            // Step 1: NORMAL state
            let data = await cocoonClient.getData();
            expect(data.state).toBe(TestConstants.STATE_NORMAL);
            expect(data.balance).toBe(toNano('10'));

            // Step 2: Request refund → CLOSING
            await cocoonClient.sendOwnerRequestRefund(owner.getSender(), toNano('0.15'), owner.address);
            data = await cocoonClient.getData();
            expect(data.state).toBe(TestConstants.STATE_CLOSING);
            expect(data.balance).toBe(toNano('1')); // Excess withdrawn

            // Step 3: Advance time
            blockchain.now = Math.floor(Date.now() / 1000) + 3700;

            // Step 4: Request refund again → CLOSED
            await cocoonClient.sendOwnerRequestRefund(owner.getSender(), toNano('0.15'), owner.address);
            data = await cocoonClient.getData();
            expect(data.state).toBe(TestConstants.STATE_CLOSED);
            expect(data.balance).toBe(0n);
        });

        it('should track multiple top-ups correctly', async () => {
            const dataBefore = await cocoonClient.getData();
            const initialBalance = dataBefore.balance;

            // Top up 3 times
            await cocoonClient.sendExtTopUp(deployer.getSender(), toNano('3'), toNano('2'), deployer.address);
            await cocoonClient.sendExtTopUp(deployer.getSender(), toNano('4'), toNano('3'), deployer.address);
            await cocoonClient.sendExtTopUp(deployer.getSender(), toNano('6'), toNano('5'), deployer.address);

            const dataAfter = await cocoonClient.getData();
            const expectedBalance = initialBalance + toNano('2') + toNano('3') + toNano('5');
            expect(dataAfter.balance).toBe(expectedBalance);
        });

        it('should track token usage progression', async () => {
            // Charge multiple times with increasing token counts
            await cocoonClient.sendChargeRequest(deployer.getSender(), 1, 100n, cocoonClient.address, deployer.address, keyPair, toNano('0.2'));
            expect(await cocoonClient.getData()).toMatchObject({ tokensUsed: 100n });

            await cocoonClient.sendChargeRequest(deployer.getSender(), 2, 250n, cocoonClient.address, deployer.address, keyPair, toNano('0.2'));
            expect(await cocoonClient.getData()).toMatchObject({ tokensUsed: 250n });

            await cocoonClient.sendChargeRequest(deployer.getSender(), 3, 500n, cocoonClient.address, deployer.address, keyPair, toNano('0.2'));
            expect(await cocoonClient.getData()).toMatchObject({ tokensUsed: 500n });
        });

        it('should allow withdraw after top-up while in NORMAL state', async () => {
            // Top up to increase balance
            await cocoonClient.sendExtTopUp(deployer.getSender(), toNano('6'), toNano('5'), deployer.address);

            let data = await cocoonClient.getData();
            expect(data.balance).toBe(toNano('15')); // 10 + 5

            // Withdraw excess
            await cocoonClient.sendOwnerWithdraw(owner.getSender(), toNano('0.15'), owner.address);

            data = await cocoonClient.getData();
            expect(data.balance).toBe(toNano('1')); // Equal to stake
        });
    });

    describe('Getters', () => {
        it('should return correct get_cocoon_client_data', async () => {
            const data = await cocoonClient.getData();

            // Verify all 9 fields
            expect(data.ownerAddress.toString()).toBe(owner.address.toString());
            expect(data.proxyAddress.toString()).toBe(proxy.address.toString());
            expect(data.proxyPublicKey).toBe(BigInt('0x' + keyPair.publicKey.toString('hex')));
            expect(data.state).toBe(TestConstants.STATE_NORMAL);
            expect(data.balance).toBe(toNano('10'));
            expect(data.stake).toBe(toNano('1'));
            expect(data.tokensUsed).toBe(0n);
            expect(data.unlockTs).toBe(0);
            expect(data.secretHash).toBe(0n);
        });

        it('should reflect state changes in getter', async () => {
            // Change secret hash
            await cocoonClient.sendOwnerChangeSecretHash(
                owner.getSender(),
                toNano('0.15'),
                12345n,
                owner.address
            );

            let data = await cocoonClient.getData();
            expect(data.secretHash).toBe(12345n);

            // Top up
            await cocoonClient.sendExtTopUp(deployer.getSender(), toNano('3'), toNano('2'), deployer.address);

            data = await cocoonClient.getData();
            expect(data.balance).toBe(toNano('12'));

            // Request refund
            await cocoonClient.sendOwnerRequestRefund(owner.getSender(), toNano('0.15'), owner.address);

            data = await cocoonClient.getData();
            expect(data.state).toBe(TestConstants.STATE_CLOSING);
            expect(data.balance).toBe(toNano('1'));
            expect(data.unlockTs).toBeGreaterThan(0);
        });
    });

    describe('Edge Cases', () => {
        it('should ignore empty messages', async () => {
            const result = await owner.send({
                to: cocoonClient.address,
                value: toNano('0.05'),
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonClient.address,
                success: true,
            });
        });

        it('should ignore OP_DO_NOT_PROCESS', async () => {
            const result = await owner.send({
                to: cocoonClient.address,
                value: toNano('0.05'),
                body: beginCell().storeUint(TestConstants.OP_DO_NOT_PROCESS, 32).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonClient.address,
                success: true,
            });
        });

        it('should reject unknown opcode', async () => {
            const result = await owner.send({
                to: cocoonClient.address,
                value: toNano('0.05'),
                body: beginCell().storeUint(0x99999999, 32).storeUint(0, 64).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonClient.address,
                success: false,
            });
        });

        it('should handle state=CLOSED for all operations', async () => {
            // Create closed client
            const config: CocoonClientConfig = {
                ownerAddress: owner.address,
                proxyAddress: proxy.address,
                proxyPublicKey: BigInt('0x' + keyPair.publicKey.toString('hex')),
                state: TestConstants.STATE_CLOSED,
                balance: toNano('10'),
                stake: toNano('1'),
                tokensUsed: 0n,
                unlockTs: 0,
                secretHash: 0n,
                params: createParamsCell(),
            };

            const closedClient = blockchain.openContract(CocoonClient.createFromConfig(config, code));
            await closedClient.sendDeploy(deployer.getSender(), toNano('15'));

            // Try various operations - all should fail
            let result = await closedClient.sendExtTopUp(deployer.getSender(), toNano('6'), toNano('5'), deployer.address);
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: closedClient.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });

            result = await closedClient.sendOwnerChangeSecretHash(owner.getSender(), toNano('0.15'), 123n, owner.address);
            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: closedClient.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });

            result = await closedClient.sendOwnerRequestRefund(owner.getSender(), toNano('0.15'), owner.address);
            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: closedClient.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });
        });
    });
});

