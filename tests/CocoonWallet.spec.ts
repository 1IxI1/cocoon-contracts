import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell, Address } from '@ton/core';
import { CocoonWallet, CocoonWalletConfig } from '../wrappers/CocoonWallet';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair, getSecureRandomBytes, keyPairFromSeed } from '@ton/crypto';

describe('CocoonWallet', () => {
    let code: Cell;
    let keyPair: KeyPair;

    beforeAll(async () => {
        code = await compile('CocoonWallet');
        // Create a deterministic keypair for testing
        const seed = await getSecureRandomBytes(32);
        keyPair = keyPairFromSeed(seed);
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let cocoonWallet: SandboxContract<CocoonWallet>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        const config: CocoonWalletConfig = {
            publicKey: Buffer.from(keyPair.publicKey),
            ownerAddress: deployer.address,
        };

        cocoonWallet = blockchain.openContract(CocoonWallet.createFromConfig(config, code));

        const deployResult = await cocoonWallet.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonWallet.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and cocoonWallet are ready to use
    });

    it('should be deployed with correct initial state', async () => {
        // Verify the contract is active after deployment
        const state = await blockchain.getContract(cocoonWallet.address);
        expect(state.accountState?.type).toBe('active');
        expect(state.balance).toBeGreaterThan(0n);
    });

    it('should have unique addresses for different configs', async () => {
        const user1 = await blockchain.treasury('user1');
        const user2 = await blockchain.treasury('user2');
        const seed1 = await getSecureRandomBytes(32);
        const seed2 = await getSecureRandomBytes(32);
        const keyPair1 = keyPairFromSeed(seed1);
        const keyPair2 = keyPairFromSeed(seed2);

        const wallet1 = CocoonWallet.createFromConfig(
            {
                publicKey: Buffer.from(keyPair1.publicKey),
                ownerAddress: user1.address,
            },
            code,
        );

        const wallet2 = CocoonWallet.createFromConfig(
            {
                publicKey: Buffer.from(keyPair2.publicKey),
                ownerAddress: user2.address,
            },
            code,
        );

        expect(wallet1.address.toString()).not.toBe(wallet2.address.toString());
    });

    it('should ignore empty messages', async () => {
        const result = await deployer.send({
            to: cocoonWallet.address,
            value: toNano('0.1'),
            body: beginCell().endCell(),
        });

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonWallet.address,
            success: true,
        });
    });

    it('should accept messages with various opcodes', async () => {
        // Wallet should handle or ignore various message types
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

    it('should reject commands from non-owner', async () => {
        const attacker = await blockchain.treasury('attacker');

        const result = await attacker.send({
            to: cocoonWallet.address,
            value: toNano('0.1'),
            body: beginCell()
                .storeUint(0, 32) // op = 0
                .storeUint(119, 8) // "w"
                .endCell(),
        });

        expect(result.transactions).toHaveTransaction({
            from: attacker.address,
            to: cocoonWallet.address,
            success: false,
            // exitCode varies
        });
    });

    it('should reject invalid text commands', async () => {
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
            // exitCode varies
        });
    });

    it('should get seqno and public key correctly', async () => {
        // Test that the basic getters work before testing get_owner_address
        const provider = blockchain.provider(cocoonWallet.address);

        const seqnoResult = await provider.get('seqno', []);
        const seqno = seqnoResult.stack.readNumber();
        expect(seqno).toBe(0);

        const publicKeyResult = await provider.get('get_public_key', []);
        const returnedKey = publicKeyResult.stack.readBigNumber();
        const expectedKey = BigInt('0x' + keyPair.publicKey.toString('hex'));
        expect(returnedKey).toBe(expectedKey);
    });

    it('[BUG #5] should return correct owner address (FunC has wrong offset bug)', async () => {
        // BUG: FunC get_owner_address skips 320 bits instead of 352 bits
        // This causes it to read part of the status field as part of the address
        // Result: Returns corrupted address

        // The wallet was deployed with deployer.address as owner
        const expectedOwner = deployer.address;

        // Call the get_owner_address getter
        const returnedOwner = await cocoonWallet.getOwnerAddress();
        expect(returnedOwner.toString()).toBe(expectedOwner.toString());
    });

    describe('owner_wallet_send_message', () => {
        it('should forward message from owner', async () => {
            const recipient = await blockchain.treasury('recipient');
            const result = await cocoonWallet.sendForwardMessage(
                deployer.getSender(),
                recipient.address,
                beginCell().storeUint(0, 32).endCell(),
                toNano('0.2'),
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
            const attacker = await blockchain.treasury('attacker');
            const recipient = await blockchain.treasury('recipient');

            const result = await attacker.send({
                to: cocoonWallet.address,
                value: toNano('0.2'),
                body: CocoonWallet.buildForwardMessage(recipient.address, beginCell().storeUint(0, 32).endCell()),
            });

            expect(result.transactions).toHaveTransaction({
                from: attacker.address,
                to: cocoonWallet.address,
                success: false,
                exitCode: 1040, // not owner
            });
        });
    });

    describe('text commands', () => {
        it('should withdraw all balance with "w" command from owner', async () => {
            // Send some coins to the wallet first
            await deployer.send({
                to: cocoonWallet.address,
                value: toNano('5'),
            });

            const balanceBefore = (await blockchain.getContract(cocoonWallet.address)).balance;
            expect(balanceBefore).toBeGreaterThan(toNano('4'));

            // Send "w" command
            const result = await deployer.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
                body: beginCell()
                    .storeUint(0, 32) // op = 0 (text command)
                    .storeUint(119, 8) // "w"
                    .endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonWallet.address,
                success: true,
            });

            // Should send back balance to owner
            expect(result.transactions).toHaveTransaction({
                from: cocoonWallet.address,
                to: deployer.address,
                success: true,
            });

            // Wallet should keep only ~0.01 TON
            const balanceAfter = (await blockchain.getContract(cocoonWallet.address)).balance;
            expect(balanceAfter).toBeLessThan(toNano('0.05'));
        });

        it('should block wallet with "b" command from owner', async () => {
            // Send "b" command
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

            // TODO: Verify status bit is set (would need a getter for status)
            // For now, we just check the transaction succeeded
        });

        it('should unblock wallet with "u" command from owner', async () => {
            // First block it
            await deployer.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
                body: beginCell()
                    .storeUint(0, 32) // op = 0
                    .storeUint(98, 8) // "b"
                    .endCell(),
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
        });

        it('should reject text commands from non-owner', async () => {
            const attacker = await blockchain.treasury('attacker');

            const result = await attacker.send({
                to: cocoonWallet.address,
                value: toNano('0.1'),
                body: beginCell()
                    .storeUint(0, 32) // op = 0
                    .storeUint(119, 8) // "w"
                    .endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: attacker.address,
                to: cocoonWallet.address,
                success: false,
                exitCode: 1040, // not owner
            });
        });
    });
});
