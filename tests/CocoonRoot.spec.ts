import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, Dictionary, beginCell } from '@ton/core';
import { CocoonRoot, CocoonRootConfig } from '../wrappers/CocoonRoot';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { TestConstants } from './helpers/fixtures';
import { assertExcessesSent } from './helpers/fixtures';

describe('CocoonRoot', () => {
    let code: Cell;
    let proxyCode: Cell;
    let workerCode: Cell;
    let clientCode: Cell;

    beforeAll(async () => {
        code = await compile('CocoonRoot');
        proxyCode = await compile('CocoonProxy');
        workerCode = await compile('CocoonWorker');
        clientCode = await compile('CocoonClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let cocoonRoot: SandboxContract<CocoonRoot>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        const config: CocoonRootConfig = {
            owner_address: deployer.address,
            proxy_hashes: Dictionary.empty(),
            registered_proxies: Dictionary.empty(),
            last_proxy_seqno: 0,
            worker_hashes: Dictionary.empty(),
            model_hashes: Dictionary.empty(),
            version: 1,
            params: {
                struct_version: 3,
                params_version: 1,
                unique_id: 12345,
                is_test: true,
                price_per_token: toNano('0.001'),
                worker_fee_per_token: toNano('0.0001'),
                prompt_tokens_price_multiplier: 11000,
                cached_tokens_price_multiplier: 12000,
                completion_tokens_price_multiplier: 13000,
                reasoning_tokens_price_multiplier: 14000,
                proxy_delay_before_close : 3600,
                client_delay_before_close: 3600,
                min_proxy_stake: toNano(1.0),
                min_client_stake: toNano(1.0),
                proxy_sc_code: proxyCode,
                worker_sc_code: workerCode,
                client_sc_code: clientCode
            }
        };

        cocoonRoot = blockchain.openContract(CocoonRoot.createFromConfig(config, code));

        const deployResult = await cocoonRoot.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and cocoonRoot are ready to use
    });

    it('should get last proxy seqno', async () => {
        const seqno = await cocoonRoot.getLastProxySeqno();
        expect(seqno).toBe(0);
    });

    it('should get cocoon data', async () => {
        const data = await cocoonRoot.getData();
        expect(data.version).toBe(1);
        expect(data.lastProxySeqno).toBe(0);
        expect(data.paramsVersion).toBe(1);
        expect(data.uniqueId).toBe(12345);
        expect(data.isTest).toBe(1); // is_test (true = 1)
    });

    it('should add proxy type', async () => {
        const proxyHash = Buffer.alloc(32, 1);
        
        const result = await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        // [BUG #6] Check that excesses are returned
        assertExcessesSent(result, deployer.address);
    });

    it('should add worker type', async () => {
        const workerHash = Buffer.alloc(32, 2);
        
        const result = await cocoonRoot.sendAddWorkerType(deployer.getSender(), workerHash);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        // [BUG #6] Check that excesses are returned
        assertExcessesSent(result, deployer.address);
    });

    it('should add model type', async () => {
        const modelHash = Buffer.alloc(32, 3);
        
        const result = await cocoonRoot.sendAddModelType(deployer.getSender(), modelHash);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        // [BUG #6] Check that excesses are returned
        assertExcessesSent(result, deployer.address);
    });

    it('should add proxy info after registering proxy type', async () => {
        const proxyHash = Buffer.alloc(32, 1);
        
        // First, add the proxy type
        await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
        
        // Then add the proxy info
        const proxyAddress = "proxy.example.com";
        const result = await cocoonRoot.sendAddProxyInfo(deployer.getSender(), proxyAddress);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        const seqno = await cocoonRoot.getLastProxySeqno();
        expect(seqno).toBe(1);
    });

    it('should change fees', async () => {
        const newPricePerToken = toNano('0.002');
        const newWorkerFee = toNano('0.0002');
        
        const result = await cocoonRoot.sendChangeFees(
            deployer.getSender(), 
            newPricePerToken, 
            newWorkerFee
        );
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        // [BUG #6] Check that excesses are returned
        assertExcessesSent(result, deployer.address);
    });

    it('should delete proxy type', async () => {
        const proxyHash = Buffer.alloc(32, 5);
        
        // Add proxy type first
        await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
        
        // Then delete it
        const result = await cocoonRoot.sendDelProxyType(deployer.getSender(), proxyHash);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        // [BUG #6] Check that excesses are returned
        assertExcessesSent(result, deployer.address);
    });

    it('should delete worker type', async () => {
        const workerHash = Buffer.alloc(32, 6);
        
        // Add worker type first
        await cocoonRoot.sendAddWorkerType(deployer.getSender(), workerHash);
        
        // Then delete it
        const result = await cocoonRoot.sendDelWorkerType(deployer.getSender(), workerHash);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
    });

    it('should delete model type', async () => {
        const modelHash = Buffer.alloc(32, 7);
        
        // Add model type first
        await cocoonRoot.sendAddModelType(deployer.getSender(), modelHash);
        
        // Then delete it
        const result = await cocoonRoot.sendDelModelType(deployer.getSender(), modelHash);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
    });

    it('should update proxy info', async () => {
        const proxyHash = Buffer.alloc(32, 8);
        const proxyAddress1 = "proxy1.example.com";
        const proxyAddress2 = "proxy2.example.com";
        
        // Add proxy type
        await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
        
        // Add proxy info
        await cocoonRoot.sendAddProxyInfo(deployer.getSender(), proxyAddress1);
        
        const seqno = await cocoonRoot.getLastProxySeqno();
        
        // Update proxy info
        const result = await cocoonRoot.sendUpdateProxyInfo(deployer.getSender(), seqno, proxyAddress2);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
    });

    it('should delete proxy info', async () => {
        const proxyHash = Buffer.alloc(32, 9);
        const proxyAddress = "proxy.delete.com";
        
        // Add proxy type
        await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
        
        // Add proxy info
        await cocoonRoot.sendAddProxyInfo(deployer.getSender(), proxyAddress);
        
        const seqno = await cocoonRoot.getLastProxySeqno();
        
        // Delete proxy info
        const result = await cocoonRoot.sendDelProxyInfo(deployer.getSender(), seqno);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
    });

    it('should change params', async () => {
        const newPricePerToken = toNano('0.003');
        const newWorkerFee = toNano('0.0003');
        const newProxyDelay = 7200;
        const newClientDelay = 7200;
        const newMinProxyStake = toNano('2');
        const newMinClientStake = toNano('2');
        
        const result = await cocoonRoot.sendChangeParams(
            deployer.getSender(),
            newPricePerToken,
            newWorkerFee,
            newProxyDelay,
            newClientDelay,
            newMinProxyStake,
            newMinClientStake
        );
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        // [BUG #6] Check that excesses are returned
        assertExcessesSent(result, deployer.address);
    });

    it('should get all params', async () => {
        const params = await cocoonRoot.getAllParams();
        
        expect(params).toBeDefined();
        expect(params?.owner_address.toString()).toBe(deployer.address.toString());
        expect(params?.version).toBe(1);
        expect(params?.last_proxy_seqno).toBe(0);
        expect(params?.params.unique_id).toBe(12345);
        expect(params?.params.is_test).toBe(true);
    });

    it('should update contract codes', async () => {
        const newProxyCode = await compile('CocoonProxy');
        const newWorkerCode = await compile('CocoonWorker');
        const newClientCode = await compile('CocoonClient');
        
        const result = await cocoonRoot.sendUpdateContracts(
            deployer.getSender(),
            newProxyCode,
            newWorkerCode,
            newClientCode
        );
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
    });

    it('should update own code', async () => {
        const newCode = await compile('CocoonRoot');
        
        const result = await cocoonRoot.sendUpdateCode(deployer.getSender(), newCode);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
    });

    it('should reject operations from non-owner', async () => {
        const attacker = await blockchain.treasury('attacker');
        const proxyHash = Buffer.alloc(32, 99);
        
        const result = await cocoonRoot.sendAddProxyType(attacker.getSender(), proxyHash);
        
        // Should fail - transaction should bounce or fail
        expect(result.transactions).toHaveTransaction({
            from: attacker.address,
            to: cocoonRoot.address,
            success: false,
        });
    });

    it('should change owner', async () => {
        const newOwner = await blockchain.treasury('newOwner');
        
        const result = await cocoonRoot.sendChangeOwner(deployer.getSender(), newOwner.address);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });

        // [BUG #6] Check that excesses are returned
        assertExcessesSent(result, deployer.address);
    });

    it('should handle multiple operations in sequence', async () => {
        // This tests workflow: add type -> register proxy -> update -> delete
        const hash = Buffer.alloc(32, 100);
        const addr1 = "test1.example.com";
        const addr2 = "test2.example.com";
        
        // Add proxy type
        await cocoonRoot.sendAddProxyType(deployer.getSender(), hash);
        
        // Register proxy
        await cocoonRoot.sendAddProxyInfo(deployer.getSender(), addr1);
        let seqno = await cocoonRoot.getLastProxySeqno();
        expect(seqno).toBeGreaterThan(0);
        
        // Update proxy
        await cocoonRoot.sendUpdateProxyInfo(deployer.getSender(), seqno, addr2);
        
        // Delete proxy
        await cocoonRoot.sendDelProxyInfo(deployer.getSender(), seqno);
        
        // Delete type
        const result = await cocoonRoot.sendDelProxyType(deployer.getSender(), hash);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
    });

    it('should validate proxy hash', async () => {
        const proxyHash = Buffer.alloc(32, 11);
        
        // Should not be valid initially
        let isValid = await cocoonRoot.getProxyHashIsValid(proxyHash);
        expect(isValid).toBe(false);
        
        // Add proxy type
        await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
        
        // Should be valid now
        isValid = await cocoonRoot.getProxyHashIsValid(proxyHash);
        expect(isValid).toBe(true);
    });

    it('should validate worker hash', async () => {
        const workerHash = Buffer.alloc(32, 12);
        
        // Should not be valid initially
        let isValid = await cocoonRoot.getWorkerHashIsValid(workerHash);
        expect(isValid).toBe(false);
        
        // Add worker type
        await cocoonRoot.sendAddWorkerType(deployer.getSender(), workerHash);
        
        // Should be valid now
        isValid = await cocoonRoot.getWorkerHashIsValid(workerHash);
        expect(isValid).toBe(true);
    });

    it('should validate model hash', async () => {
        const modelHash = Buffer.alloc(32, 13);
        
        // Should not be valid initially
        let isValid = await cocoonRoot.getModelHashIsValid(modelHash);
        expect(isValid).toBe(false);
        
        // Add model type
        await cocoonRoot.sendAddModelType(deployer.getSender(), modelHash);
        
        // Should be valid now
        isValid = await cocoonRoot.getModelHashIsValid(modelHash);
        expect(isValid).toBe(true);
    });

    it('should reset all dictionaries', async () => {
        // Add various types
        const proxyHash = Buffer.alloc(32, 14);
        const workerHash = Buffer.alloc(32, 15);
        const modelHash = Buffer.alloc(32, 16);
        
        await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
        await cocoonRoot.sendAddWorkerType(deployer.getSender(), workerHash);
        await cocoonRoot.sendAddModelType(deployer.getSender(), modelHash);
        
        // Verify they exist
        expect(await cocoonRoot.getProxyHashIsValid(proxyHash)).toBe(true);
        expect(await cocoonRoot.getWorkerHashIsValid(workerHash)).toBe(true);
        expect(await cocoonRoot.getModelHashIsValid(modelHash)).toBe(true);
        
        // Reset all
        const result = await cocoonRoot.sendReset(deployer.getSender());
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
        
        // Verify they're gone
        expect(await cocoonRoot.getProxyHashIsValid(proxyHash)).toBe(false);
        expect(await cocoonRoot.getWorkerHashIsValid(workerHash)).toBe(false);
        expect(await cocoonRoot.getModelHashIsValid(modelHash)).toBe(false);
    });

    it('should perform full upgrade', async () => {
        const newCode = await compile('CocoonRoot');
        
        // Create a minimal new data cell (just to test the upgrade mechanism)
        const newConfig: CocoonRootConfig = {
            owner_address: deployer.address,
            proxy_hashes: Dictionary.empty(),
            registered_proxies: Dictionary.empty(),
            last_proxy_seqno: 999,  // Different value to verify upgrade
            worker_hashes: Dictionary.empty(),
            model_hashes: Dictionary.empty(),
            version: 2,
            params: {
                struct_version: 3,
                params_version: 2,
                unique_id: 54321,
                is_test: false,
                price_per_token: toNano('0.005'),
                worker_fee_per_token: toNano('0.0005'),
                prompt_tokens_price_multiplier: 21000,
                cached_tokens_price_multiplier: 22000,
                completion_tokens_price_multiplier: 23000,
                reasoning_tokens_price_multiplier: 24000,
                proxy_delay_before_close : 7200,
                client_delay_before_close: 7200,
                min_proxy_stake: toNano(5),
                min_client_stake: toNano(5),
                proxy_sc_code: proxyCode,
                worker_sc_code: workerCode,
                client_sc_code: clientCode
            }
        };
        
        const result = await cocoonRoot.sendUpgradeFull(deployer.getSender(), newConfig, newCode);
        
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonRoot.address,
            success: true,
        });
        
        // Verify data was updated
        const seqno = await cocoonRoot.getLastProxySeqno();
        expect(seqno).toBe(999);
        
        const data = await cocoonRoot.getData();
        expect(data.paramsVersion).toBe(2);
        expect(data.uniqueId).toBe(54321);
        expect(data.isTest).toBe(0); // is_test (false = 0)
    });

    describe('Getter methods', () => {
        it('should return all values from get_cocoon_data', async () => {
            const result = await blockchain.provider(cocoonRoot.address).get('get_cocoon_data', []);
            
            const version = result.stack.readNumber();
            const lastProxySeqno = result.stack.readNumber();
            const paramsVersion = result.stack.readNumber();
            const uniqueId = result.stack.readNumber();
            const isTest = result.stack.readNumber();
            const pricePerToken = result.stack.readBigNumber();
            const workerFeePerToken = result.stack.readBigNumber();
            const minProxyStake = result.stack.readBigNumber();
            const minClientStake = result.stack.readBigNumber();
            const ownerAddress = result.stack.readAddress();
            
            // Verify values
            expect(version).toBe(1);
            expect(lastProxySeqno).toBe(0);
            expect(paramsVersion).toBe(1);
            expect(uniqueId).toBe(12345);
            expect(isTest).toBe(1);
            expect(pricePerToken).toBe(toNano('0.001'));
            expect(workerFeePerToken).toBe(toNano('0.0001'));
            expect(minProxyStake).toBe(toNano('1.0'));
            expect(minClientStake).toBe(toNano('1.0'));
            expect(ownerAddress.toString()).toBe(deployer.address.toString());
        });

        it('should return all values from get_cur_params', async () => {
            const result = await blockchain.provider(cocoonRoot.address).get('get_cur_params', []);
            
            const paramsVersion = result.stack.readNumber();
            const uniqueId = result.stack.readNumber();
            const isTest = result.stack.readNumber();
            const pricePerToken = result.stack.readBigNumber();
            const workerFeePerToken = result.stack.readBigNumber();
            const cachedTokensPriceMultiplier = result.stack.readNumber();
            const reasoningTokensPriceMultiplier = result.stack.readNumber();
            const proxyDelayBeforeClose = result.stack.readNumber();
            const clientDelayBeforeClose = result.stack.readNumber();
            const minProxyStake = result.stack.readBigNumber();
            const minClientStake = result.stack.readBigNumber();
            const proxyScHash = result.stack.readBigNumber();
            const workerScHash = result.stack.readBigNumber();
            const clientScHash = result.stack.readBigNumber();
            
            // Verify values
            expect(paramsVersion).toBe(1);
            expect(uniqueId).toBe(12345);
            expect(isTest).toBe(1);
            expect(pricePerToken).toBe(toNano('0.001'));
            expect(workerFeePerToken).toBe(toNano('0.0001'));
            expect(cachedTokensPriceMultiplier).toBe(12000);
            expect(reasoningTokensPriceMultiplier).toBe(14000);
            expect(proxyDelayBeforeClose).toBe(3600);
            expect(clientDelayBeforeClose).toBe(3600);
            expect(minProxyStake).toBe(toNano('1.0'));
            expect(minClientStake).toBe(toNano('1.0'));
            expect(proxyScHash).toBeGreaterThan(0n);
            expect(workerScHash).toBeGreaterThan(0n);
            expect(clientScHash).toBeGreaterThan(0n);
        });

        it('should validate proxy hash correctly', async () => {
            const proxyHash = Buffer.alloc(32, 150);
            
            // Should be invalid initially
            let result = await blockchain.provider(cocoonRoot.address).get('proxy_hash_is_valid', [
                { type: 'int', value: BigInt('0x' + proxyHash.toString('hex')) }
            ]);
            expect(result.stack.readNumber()).toBe(0);
            
            // Add the hash
            await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
            
            // Should be valid now
            result = await blockchain.provider(cocoonRoot.address).get('proxy_hash_is_valid', [
                { type: 'int', value: BigInt('0x' + proxyHash.toString('hex')) }
            ]);
            expect(result.stack.readNumber()).toBe(-1);
        });

        it('should validate worker hash correctly', async () => {
            const workerHash = Buffer.alloc(32, 151);
            
            // Should be invalid initially
            let result = await blockchain.provider(cocoonRoot.address).get('worker_hash_is_valid', [
                { type: 'int', value: BigInt('0x' + workerHash.toString('hex')) }
            ]);
            expect(result.stack.readNumber()).toBe(0);
            
            // Add the hash
            await cocoonRoot.sendAddWorkerType(deployer.getSender(), workerHash);
            
            // Should be valid now
            result = await blockchain.provider(cocoonRoot.address).get('worker_hash_is_valid', [
                { type: 'int', value: BigInt('0x' + workerHash.toString('hex')) }
            ]);
            expect(result.stack.readNumber()).toBe(-1);
        });

        it('should validate model hash correctly', async () => {
            const modelHash = Buffer.alloc(32, 152);
            
            // Should be invalid initially
            let result = await blockchain.provider(cocoonRoot.address).get('model_hash_is_valid', [
                { type: 'int', value: BigInt('0x' + modelHash.toString('hex')) }
            ]);
            expect(result.stack.readNumber()).toBe(0);
            
            // Add the hash
            await cocoonRoot.sendAddModelType(deployer.getSender(), modelHash);
            
            // Should be valid now
            result = await blockchain.provider(cocoonRoot.address).get('model_hash_is_valid', [
                { type: 'int', value: BigInt('0x' + modelHash.toString('hex')) }
            ]);
            expect(result.stack.readNumber()).toBe(-1);
        });

        it('should return correct last_proxy_seqno', async () => {
            const proxyHash = Buffer.alloc(32, 153);
            await cocoonRoot.sendAddProxyType(deployer.getSender(), proxyHash);
            
            // Add some proxies
            await cocoonRoot.sendAddProxyInfo(deployer.getSender(), "proxy1.example.com");
            let seqno = await cocoonRoot.getLastProxySeqno();
            expect(seqno).toBe(1);
            
            await cocoonRoot.sendAddProxyInfo(deployer.getSender(), "proxy2.example.com");
            seqno = await cocoonRoot.getLastProxySeqno();
            expect(seqno).toBe(2);
            
            await cocoonRoot.sendAddProxyInfo(deployer.getSender(), "proxy3.example.com");
            seqno = await cocoonRoot.getLastProxySeqno();
            expect(seqno).toBe(3);
        });
    });
});
