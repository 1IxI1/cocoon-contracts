import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell, Address } from '@ton/core';
import { CocoonWallet, CocoonWalletConfig } from '../wrappers/CocoonWallet';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair, getSecureRandomBytes, keyPairFromSeed, sign } from '@ton/crypto';
import { TestKeyPairs, TestConstants, disableConsoleError } from './helpers/fixtures';
import { assertExternalMessageFails } from './helpers/fixtures';

describe('CocoonWallet - Comprehensive', () => {
    let code: Cell;
    let keyPair: KeyPair;

    beforeAll(async () => {
        code = await compile('CocoonWallet');
        keyPair = TestKeyPairs.WALLET_KEYPAIR;
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let attacker: SandboxContract<TreasuryContract>;
    let cocoonWallet: SandboxContract<CocoonWallet>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        attacker = await blockchain.treasury('attacker');

        const config: CocoonWalletConfig = {
            publicKey: Buffer.from(keyPair.publicKey),
            ownerAddress: deployer.address,
        };

        cocoonWallet = blockchain.openContract(CocoonWallet.createFromConfig(config, code));

        const deployResult = await cocoonWallet.sendDeploy(deployer.getSender(), toNano('5'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonWallet.address,
            deploy: true,
            success: true,
        });
    });

    describe('External Messages (Signed)', () => {

        it('should accept valid external message and send outbound messages', async () => {
            const recipient = await blockchain.treasury('recipient');

            const result = await cocoonWallet.sendExternalSigned(
                [{ to: recipient.address, value: toNano('0.1') }],
                keyPair,
                { seqno: 0 }
            );

            expect(result.transactions).toHaveTransaction({
                on: cocoonWallet.address,
                success: true,
            });

            // Verify seqno incremented
            expect(await cocoonWallet.getSeqno()).toBe(1);

            // Verify message was sent
            expect(result.transactions).toHaveTransaction({ 
                to: recipient.address, 
                value: (v) => v !== undefined && v >= toNano('0.09'),
                success: true,
            });
        });

        it('should reject expired external message', async () => {
            const validUntil = Math.floor(Date.now() / 1000) - 3600; // Expired
            await assertExternalMessageFails(
                blockchain,
                cocoonWallet.address,
                CocoonWallet.createExternalMessage([], keyPair, { seqno: 0, validUntil }),
                TestConstants.WALLET_ERROR_EXPIRED
            );
        });

        it('should reject external message when blocked', async () => {
            // First block the wallet
            await deployer.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
                body: beginCell()
                    .storeUint(0, 32) // op = 0
                    .storeUint(98, 8) // "b"
                    .endCell(),
            });

            await assertExternalMessageFails(
                blockchain,
                cocoonWallet.address,
                CocoonWallet.createExternalMessage([], keyPair, { seqno: 0 }),
                TestConstants.WALLET_ERROR_BLOCKED
            );
        });

        it('should reject external message with wrong seqno', async () => {
            await assertExternalMessageFails(
                blockchain,
                cocoonWallet.address,
                CocoonWallet.createExternalMessage([], keyPair, { seqno: 999 }),
                TestConstants.WALLET_ERROR_WRONG_SEQNO
            );
        });

        it('should reject external message with wrong subwallet', async () => {
            await assertExternalMessageFails(
                blockchain,
                cocoonWallet.address,
                CocoonWallet.createExternalMessage([], keyPair, { seqno: 0, subwalletId: 999 }),
                TestConstants.WALLET_ERROR_WRONG_SUBWALLET
            );
        });

        it('should reject external message with bad signature', async () => {
            await assertExternalMessageFails(
                blockchain,
                cocoonWallet.address,
                CocoonWallet.createExternalMessage([], TestKeyPairs.WRONG_KEYPAIR, { seqno: 0 }),
                TestConstants.WALLET_ERROR_BAD_SIGNATURE
            );
        });

        it('should reject external message with low balance', async () => {
            // Deploy wallet with DIFFERENT keypair and low balance
            const lowBalanceKeyPair = keyPairFromSeed(await getSecureRandomBytes(32));
            
            const lowBalanceWallet = blockchain.openContract(
                CocoonWallet.createFromConfig({
                    publicKey: Buffer.from(lowBalanceKeyPair.publicKey),
                    ownerAddress: deployer.address,
                }, code)
            );

            await lowBalanceWallet.sendDeploy(deployer.getSender(), toNano('0.5')); // Less than 2 TON

            // sendExternalSigned will throw, use createExternalMessage for assertExternalMessageFails
            await assertExternalMessageFails(
                blockchain,
                lowBalanceWallet.address,
                CocoonWallet.createExternalMessage([], lowBalanceKeyPair, { seqno: 0 }),
                TestConstants.WALLET_ERROR_LOW_BALANCE
            );
        });

        it('should send multiple messages in one external call', async () => {
            const recipient1 = await blockchain.treasury('recipient1');
            const recipient2 = await blockchain.treasury('recipient2');

            const result = await cocoonWallet.sendExternalSigned(
                [
                    { to: recipient1.address, value: toNano('0.1') },
                    { to: recipient2.address, value: toNano('0.2') },
                ],
                keyPair,
                { seqno: 0 }
            );

            expect(result.transactions).toHaveTransaction({
                on: cocoonWallet.address,
                success: true,
            });
            
            expect(result.transactions).toHaveTransaction({ 
                to: recipient1.address, 
                value: (v) => v !== undefined && v >= toNano('0.09'),
                success: true,
            });
            expect(result.transactions).toHaveTransaction({ 
                to: recipient2.address, 
                value: (v) => v !== undefined && v >= toNano('0.19'),
                success: true,
            });
        });

        it('should send message with body', async () => {
            const recipient = await blockchain.treasury('recipient');
            const testBody = beginCell()
                .storeUint(0x12345678, 32)
                .storeUint(42, 64)
                .endCell();

            const result = await cocoonWallet.sendExternalSigned(
                [{ to: recipient.address, value: toNano('0.1'), body: testBody }],
                keyPair,
                { seqno: 0 }
            );

            expect(result.transactions).toHaveTransaction({
                on: cocoonWallet.address,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({ 
                to: recipient.address,
                op: 0x12345678,
                success: true,
            });
        });

        it('should send non-bounceable message', async () => {
            const recipient = await blockchain.treasury('recipient');

            const result = await cocoonWallet.sendExternalSigned(
                [{ to: recipient.address, value: toNano('0.1'), bounce: false }],
                keyPair,
                { seqno: 0 }
            );

            expect(result.transactions).toHaveTransaction({
                on: cocoonWallet.address,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({ 
                to: recipient.address,
                inMessageBounceable: false,
                success: true,
            });
        });

        it('should auto-increment seqno across multiple calls', async () => {
            const recipient = await blockchain.treasury('recipient');

            // First call - seqno should be 0
            await cocoonWallet.sendExternalSigned(
                [{ to: recipient.address, value: toNano('0.05') }],
                keyPair
                // seqno auto-fetched
            );
            expect(await cocoonWallet.getSeqno()).toBe(1);

            // Second call - seqno should be 1
            await cocoonWallet.sendExternalSigned(
                [{ to: recipient.address, value: toNano('0.05') }],
                keyPair
            );
            expect(await cocoonWallet.getSeqno()).toBe(2);

            // Third call - seqno should be 2
            await cocoonWallet.sendExternalSigned(
                [{ to: recipient.address, value: toNano('0.05') }],
                keyPair
            );
            expect(await cocoonWallet.getSeqno()).toBe(3);
        });

        it('should send maximum 4 messages in one external call', async () => {
            const [r1, r2, r3, r4] = await blockchain.createWallets(4);

            const result = await cocoonWallet.sendExternalSigned(
                [
                    { to: r1.address, value: toNano('0.05') },
                    { to: r2.address, value: toNano('0.05') },
                    { to: r3.address, value: toNano('0.05') },
                    { to: r4.address, value: toNano('0.05') },
                ],
                keyPair,
                { seqno: 0 }
            );

            expect(result.transactions).toHaveTransaction({
                on: cocoonWallet.address,
                success: true,
                outMessagesCount: 4,
            });
        });

        it('should handle empty message list (no-op)', async () => {
            const result = await cocoonWallet.sendExternalSigned(
                [],
                keyPair,
                { seqno: 0 }
            );

            expect(result.transactions).toHaveTransaction({
                on: cocoonWallet.address,
                success: true,
                outMessagesCount: 0,
            });

            // Seqno should still increment
            expect(await cocoonWallet.getSeqno()).toBe(1);
        });
    });

    describe('Internal Messages', () => {
        describe('OwnerWalletSendMessage', () => {
            it('should forward message from owner', async () => {
                const recipient = await blockchain.treasury('recipient');
                const result = await cocoonWallet.sendForwardMessage(
                    deployer.getSender(),
                    recipient.address,
                    beginCell().storeUint(0, 32).endCell(),
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonWallet.address,
                    success: true,
                });
                
                expect(result.transactions).toHaveTransaction({ 
                    from: cocoonWallet.address, 
                    to: recipient.address,
                    success: true,
                });
            });

            it('should reject forward message from non-owner', async () => {
                const recipient = await blockchain.treasury('recipient');

                const result = await cocoonWallet.sendForwardMessage(
                    attacker.getSender(),
                    recipient.address,
                    beginCell().storeUint(0, 32).endCell(),
                    toNano('0.2')
                );

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonWallet.address,
                    success: false,
                    exitCode: TestConstants.WALLET_ERROR_NOT_OWNER,
                });
            });
        });

        describe('Text Commands', () => {
            it('should withdraw with "w" command', async () => {
                const balanceBefore = (await blockchain.getContract(cocoonWallet.address)).balance;

                const result = await deployer.send({
                    to: cocoonWallet.address,
                    value: toNano('0.1'),
                    body: beginCell()
                        .storeUint(0, 32) // op = 0
                        .storeUint(119, 8) // "w"
                        .endCell(),
                });

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonWallet.address,
                    success: true,
                });

                // Verify balance reduced to ~0.01
                const balanceAfter = (await blockchain.getContract(cocoonWallet.address)).balance;
                expect(balanceAfter).toBeLessThan(toNano('0.05'));

                // Verify message sent back
                expect(result.transactions).toHaveTransaction({ 
                    from: cocoonWallet.address, 
                    to: deployer.address,
                    success: true,
                });
            });

            it('should block wallet with "b" command', async () => {
                const result = await deployer.send({
                    to: cocoonWallet.address,
                    value: toNano('0.1'),
                    body: beginCell()
                        .storeUint(0, 32) // op = 0
                        .storeUint(98, 8) // "b"
                        .endCell(),
                });

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonWallet.address,
                    success: true,
                });

                // External message should not work when blocked
                await assertExternalMessageFails(
                    blockchain,
                    cocoonWallet.address,
                    CocoonWallet.createExternalMessage([], keyPair, { seqno: 0 }),
                    TestConstants.WALLET_ERROR_BLOCKED
                );
            });

            it('should unblock wallet with "u" command', async () => {
                // First block
                await deployer.send({
                    to: cocoonWallet.address,
                    value: toNano('0.1'),
                    body: beginCell().storeUint(0, 32).storeUint(98, 8).endCell(),
                });

                // Then unblock
                const result = await deployer.send({
                    to: cocoonWallet.address,
                    value: toNano('0.1'),
                    body: beginCell()
                        .storeUint(0, 32) // op = 0
                        .storeUint(117, 8) // "u"
                        .endCell(),
                });

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonWallet.address,
                    success: true,
                });

                // External message should work now
                const extResult = await cocoonWallet.sendExternalSigned([], keyPair, { seqno: 0 });

                expect(extResult.transactions).toHaveTransaction({
                    on: cocoonWallet.address,
                    success: true,
                });
            });

            it('should reject text commands from non-owner', async () => {
                const result = await attacker.send({
                    to: cocoonWallet.address,
                    value: toNano('0.1'),
                    body: beginCell().storeUint(0, 32).storeUint(119, 8).endCell(),
                });

                expect(result.transactions).toHaveTransaction({
                    from: attacker.address,
                    to: cocoonWallet.address,
                    success: false,
                    exitCode: TestConstants.WALLET_ERROR_NOT_OWNER,
                });
            });

            it('should reject unknown text command', async () => {
                const result = await deployer.send({
                    to: cocoonWallet.address,
                    value: toNano('0.1'),
                    body: beginCell()
                        .storeUint(0, 32) // op = 0
                        .storeUint(120, 8) // "x" - invalid
                        .endCell(),
                });

                expect(result.transactions).toHaveTransaction({
                    from: deployer.address,
                    to: cocoonWallet.address,
                    success: false,
                    exitCode: TestConstants.WALLET_ERROR_UNKNOWN_TEXT_CMD,
                });
            });
        });
    });

    describe('Getters', () => {
        it('should return correct seqno', async () => {
            const seqnoResult = await blockchain.provider(cocoonWallet.address).get('seqno', []);
            const seqno = seqnoResult.stack.readNumber();
            expect(seqno).toBe(0);
        });

        it('should return correct public key', async () => {
            const publicKeyResult = await blockchain.provider(cocoonWallet.address).get('get_public_key', []);
            const publicKey = publicKeyResult.stack.readBigNumber();
            const expectedKey = BigInt('0x' + keyPair.publicKey.toString('hex'));
            expect(publicKey).toBe(expectedKey);
        });

        it('should return correct owner address', async () => {
            const ownerResult = await blockchain.provider(cocoonWallet.address).get('get_owner_address', []);
            const ownerAddress = ownerResult.stack.readAddress();
            expect(ownerAddress.toString()).toBe(deployer.address.toString());
        });
    });

    describe('Edge Cases', () => {
        it('should ignore empty messages', async () => {
            const result = await deployer.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonWallet.address,
                success: true,
            });
        });

        it('should ignore OP_EXCESSES', async () => {
            const result = await deployer.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(TestConstants.OP_EXCESSES, 32).storeUint(0, 64).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonWallet.address,
                success: true,
            });
        });

        it('should ignore OP_PAYOUT', async () => {
            const result = await deployer.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(TestConstants.OP_PAYOUT, 32).storeUint(0, 64).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonWallet.address,
                success: true,
            });
        });

        it('should ignore OP_DO_NOT_PROCESS', async () => {
            const result = await deployer.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
                body: beginCell().storeUint(TestConstants.OP_DO_NOT_PROCESS, 32).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonWallet.address,
                success: true,
            });
        });
    });
});

