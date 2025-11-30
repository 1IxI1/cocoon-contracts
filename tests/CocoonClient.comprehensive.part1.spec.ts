import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { beginCell, Cell, toNano } from '@ton/core';
import { CocoonClient, CocoonClientConfig } from '../wrappers/CocoonClient';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair } from '@ton/crypto';
import { TestKeyPairs, createParamsCell, TestConstants } from './helpers/fixtures';

describe('CocoonClient - Comprehensive (Part 1: Signed Messages & Owner Ops)', () => {
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
            params: createParamsCell(),
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

    describe('Common Patterns', () => {
        it('should reject messages with low value', async () => {
            const result = await cocoonClient.sendExtTopUp(
                deployer.getSender(),
                toNano('0.001'),
                toNano('0.5'),
                deployer.address
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonClient.address,
                success: false,
                exitCode: TestConstants.ERROR_LOW_MSG_VALUE,
            });
        });

        it('should reject owner messages from non-owner (parameterized)', async () => {
            // Test one representative message
            const result = await cocoonClient.sendOwnerRegister(
                attacker.getSender(),
                toNano('0.15'),
                123n,
                attacker.address
            );

            expect(result.transactions).toHaveTransaction({
                from: attacker.address,
                to: cocoonClient.address,
                success: false,
                exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
            });
        });
    });

    describe('Signed Messages', () => {
        describe('ExtClientChargeSigned (0xbb63ff93)', () => {
            it('should accept valid charge and update state', async () => {
                const queryId = 123;
                const newTokensUsed = 500n;

                const result = await cocoonClient.sendChargeRequest(
                    deployer.getSender(),
                    queryId,
                    newTokensUsed,
                    cocoonClient.address,
                    deployer.address,
                    keyPair,
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonClient.address,
                    success: true,
                });

                // Verify ClientProxyRequest sent
                expect(result.transactions).toHaveTransaction({
                    from: cocoonClient.address,
                    to: proxy.address,
                    op: TestConstants.OP_CLIENT_PROXY_REQUEST,
                    // success: true,
                });

                // Verify state updated
                const data = await cocoonClient.getData();
                expect(data.tokensUsed).toBe(newTokensUsed);
            });

            it('should reject charge with bad signature', async () => {
                const wrongKeyPair = TestKeyPairs.WRONG_KEYPAIR;

                const result = await cocoonClient.sendChargeRequest(
                    deployer.getSender(),
                    123,
                    500n,
                    cocoonClient.address,
                    deployer.address,
                    wrongKeyPair,
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_BAD_SIGNATURE,
                });
            });

            it('should reject charge with old tokens (tokensUsed >= newTokensUsed)', async () => {
                // First charge
                await cocoonClient.sendChargeRequest(
                    deployer.getSender(),
                    123,
                    500n,
                    cocoonClient.address,
                    deployer.address,
                    keyPair,
                    toNano('0.2')
                );

                // Try same token count
                const result = await cocoonClient.sendChargeRequest(
                    deployer.getSender(),
                    124,
                    500n,
                    cocoonClient.address,
                    deployer.address,
                    keyPair,
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_OLD_MESSAGE,
                });
            });

            it('should reject charge with wrong expected address', async () => {
                const result = await cocoonClient.sendChargeRequest(
                    deployer.getSender(),
                    123,
                    500n,
                    attacker.address, // Wrong address
                    deployer.address,
                    keyPair,
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MY_ADDRESS,
                });
            });
        });

        describe('ExtClientGrantRefundSigned (0xefd711e1)', () => {
            it('should grant refund and close client', async () => {
                const queryId = 456;
                const newTokensUsed = 1000n;

                const result = await cocoonClient.sendGrantRefundRequest(
                    deployer.getSender(),
                    queryId,
                    newTokensUsed,
                    cocoonClient.address,
                    deployer.address,
                    keyPair,
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonClient.address,
                    success: true,
                });

                // Verify ClientProxyRequest sent with CARRY_ALL
                expect(result.transactions).toHaveTransaction({
                    from: cocoonClient.address,
                    to: proxy.address,
                    op: TestConstants.OP_CLIENT_PROXY_REQUEST,
                    success: true,
                });

                // Verify state closed and balance zeroed
                const data = await cocoonClient.getData();
                expect(data.state).toBe(TestConstants.STATE_CLOSED);
                expect(data.balance).toBe(0n);
                expect(data.tokensUsed).toBe(newTokensUsed);
            });

            it('should reject grant refund with bad signature', async () => {
                const wrongKeyPair = TestKeyPairs.WRONG_KEYPAIR;

                const result = await cocoonClient.sendGrantRefundRequest(
                    deployer.getSender(),
                    456,
                    1000n,
                    cocoonClient.address,
                    deployer.address,
                    wrongKeyPair,
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_BAD_SIGNATURE,
                });
            });

            it('should reject grant refund with invalid tokens (tokensUsed > newTokensUsed)', async () => {
                // First charge to 500 tokens
                await cocoonClient.sendChargeRequest(
                    deployer.getSender(),
                    123,
                    500n,
                    cocoonClient.address,
                    deployer.address,
                    keyPair,
                    toNano('0.2')
                );

                // Try grant refund with lower count
                const result = await cocoonClient.sendGrantRefundRequest(
                    deployer.getSender(),
                    456,
                    300n, // Lower than current
                    cocoonClient.address,
                    deployer.address,
                    keyPair,
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_OLD_MESSAGE,
                });
            });
        });
    });

    describe('External TopUp', () => {
        it('should top up balance successfully', async () => {
            const topUpAmount = toNano('5');
            const dataBefore = await cocoonClient.getData();

            const result = await cocoonClient.sendExtTopUp(
                deployer.getSender(),
                toNano('6'),
                topUpAmount,
                deployer.address
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonClient.address,
                success: true,
            });

            // Verify balance increased
            const dataAfter = await cocoonClient.getData();
            expect(dataAfter.balance).toBe(dataBefore.balance + topUpAmount);

            // Verify ClientProxyRequest sent
            expect(result.transactions).toHaveTransaction({
                from: cocoonClient.address,
                to: proxy.address,
                op: TestConstants.OP_CLIENT_PROXY_REQUEST,
                // success: true,
            });
        });

        it('should reject top up if closed', async () => {
            // Create closed client
            const closedConfig: CocoonClientConfig = {
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

            const closedClient = blockchain.openContract(CocoonClient.createFromConfig(closedConfig, code));
            await closedClient.sendDeploy(deployer.getSender(), toNano('15'));

            const result = await closedClient.sendExtTopUp(
                deployer.getSender(),
                toNano('6'),
                toNano('5'),
                deployer.address
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: closedClient.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });
        });

        it('should reject top up with low value', async () => {
            const result = await cocoonClient.sendExtTopUp(
                deployer.getSender(),
                toNano('0.5'), // topUpAmount + COMMISSION > this
                toNano('5'),
                deployer.address
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonClient.address,
                success: false,
                exitCode: TestConstants.ERROR_LOW_MSG_VALUE,
            });
        });
    });

    describe('Owner Messages - Part 1 (Register, SecretHash)', () => {
        describe('OwnerClientRegister', () => {
            it('should register successfully', async () => {
                const result = await cocoonClient.sendOwnerRegister(
                    owner.getSender(),
                    toNano('0.15'),
                    123n,
                    owner.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonClient.address,
                    success: true,
                });

                // Verify ClientProxyRequest sent
                expect(result.transactions).toHaveTransaction({
                    from: cocoonClient.address,
                    to: proxy.address,
                    op: TestConstants.OP_CLIENT_PROXY_REQUEST,
                    // success: true, fake proxy
                });
            });

            it('should reject register from non-owner', async () => {
                const result = await cocoonClient.sendOwnerRegister(
                    attacker.getSender(),
                    toNano('0.15'),
                    123n,
                    attacker.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
                });
            });
        });

        describe('OwnerClientChangeSecretHash', () => {
            it('should change secret hash', async () => {
                const newSecretHash = 12345n;

                const result = await cocoonClient.sendOwnerChangeSecretHash(
                    owner.getSender(),
                    toNano('0.15'),
                    newSecretHash,
                    owner.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonClient.address,
                    success: true,
                });

                const data = await cocoonClient.getData();
                expect(data.secretHash).toBe(newSecretHash);
            });

            it('should reject change secret hash from non-owner', async () => {
                const result = await cocoonClient.sendOwnerChangeSecretHash(
                    attacker.getSender(),
                    toNano('0.15'),
                    12345n,
                    attacker.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
                });
            });
        });

        describe('OwnerClientChangeSecretHashAndTopUp', () => {
            it('should change secret hash and top up', async () => {
                const newSecretHash = 99999n;
                const topUpAmount = toNano('5');
                const dataBefore = await cocoonClient.getData();

                const result = await cocoonClient.sendOwnerChangeSecretHashAndTopUp(
                    owner.getSender(),
                    toNano('6'),
                    topUpAmount,
                    newSecretHash,
                    owner.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonClient.address,
                    success: true,
                });

                const dataAfter = await cocoonClient.getData();
                expect(dataAfter.secretHash).toBe(newSecretHash);
                expect(dataAfter.balance).toBe(dataBefore.balance + topUpAmount);
            });

            it('should reject from non-owner', async () => {
                const result = await cocoonClient.sendOwnerChangeSecretHashAndTopUp(
                    attacker.getSender(),
                    toNano('6'),
                    toNano('5'),
                    99999n,
                    attacker.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
                });
            });
        });
    });

    describe('Owner Messages - Part 2 (Stake, Withdraw)', () => {
        describe('OwnerClientIncreaseStake', () => {
            it('should increase stake successfully', async () => {
                const dataBefore = await cocoonClient.getData();
                const newStake = toNano('4');

                const result = await cocoonClient.sendOwnerIncreaseStake(
                    owner.getSender(),
                    toNano('1'),
                    newStake,
                    owner.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonClient.address,
                    success: true,
                });

                const dataAfter = await cocoonClient.getData();
                expect(dataAfter.stake).toBe(newStake);
            });

            it('should reject decrease stake (BUG #4)', async () => {
                // Current stake is 1 TON
                const newStake = toNano('0.5'); // Lower

                const result = await cocoonClient.sendOwnerIncreaseStake(
                    owner.getSender(),
                    toNano('1'),
                    newStake,
                    owner.address
                );

                // Should fail because new_stake <= current_stake (inverted logic bug)
                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_LOW_MSG_VALUE,
                });
            });

            it('should reject from non-owner', async () => {
                const result = await cocoonClient.sendOwnerIncreaseStake(
                    attacker.getSender(),
                    toNano('1'),
                    toNano('4'),
                    attacker.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_EXPECTED_MESSAGE_FROM_OWNER,
                });
            });
        });

        describe('OwnerClientWithdraw', () => {
            it('should withdraw excess balance (balance > stake)', async () => {
                // Client has balance = 10 TON, stake = 1 TON
                const result = await cocoonClient.sendOwnerWithdraw(
                    owner.getSender(),
                    toNano('0.15'),
                    owner.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: cocoonClient.address,
                    success: true,
                });

                // Verify balance reduced to stake
                const data = await cocoonClient.getData();
                expect(data.balance).toBe(toNano('1')); // Equal to stake

                // Verify ClientProxyRequest sent
                expect(result.transactions).toHaveTransaction({
                    from: cocoonClient.address,
                    to: proxy.address,
                    op: TestConstants.OP_CLIENT_PROXY_REQUEST,
                    // success: true,
                });
            });

            it('should reject withdraw if balance <= stake', async () => {
                // Create client with balance = stake
                const config: CocoonClientConfig = {
                    ownerAddress: owner.address,
                    proxyAddress: proxy.address,
                    proxyPublicKey: BigInt('0x' + keyPair.publicKey.toString('hex')),
                    state: TestConstants.STATE_NORMAL,
                    balance: toNano('0.5'), // Less than stake
                    stake: toNano('1'),
                    tokensUsed: 0n,
                    unlockTs: 0,
                    secretHash: 0n,
                    params: createParamsCell(),
                };

                const lowBalanceClient = blockchain.openContract(CocoonClient.createFromConfig(config, code));
                await lowBalanceClient.sendDeploy(deployer.getSender(), toNano('5'));

                const result = await lowBalanceClient.sendOwnerWithdraw(
                    owner.getSender(),
                    toNano('0.15'),
                    owner.address
                );

                expect(result.transactions).toHaveTransaction({
                    from: owner.address,
                    to: lowBalanceClient.address,
                    success: false,
                    exitCode: TestConstants.ERROR_LOW_SMC_BALANCE,
                });
            });

            it('should reject withdraw from non-owner', async () => {
                const result = await cocoonClient.sendOwnerWithdraw(
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
    });
});

