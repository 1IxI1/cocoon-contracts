import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { CocoonProxy } from '../wrappers/CocoonProxy';
import { CocoonParams, cocoonParamsToCell } from '../wrappers/CocoonRoot';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

const USE_TOLK = process.env.USE_TOLK === 'true';

// Opcodes
const OP_DO_NOT_PROCESS = 0x9a1247c0;
const OP_EXT_PROXY_PAYOUT_REQUEST = 0x7610e6eb;
const OP_EXT_PROXY_INCREASE_STAKE = 0x9713f187;
const OP_OWNER_PROXY_CLOSE = 0xb51d5a01;

describe('CocoonProxy', () => {
    let code: Cell;
    let workerCode: Cell;
    let clientCode: Cell;

    beforeAll(async () => {
        code = await compile('CocoonProxy');
        workerCode = await compile('CocoonWorker');
        clientCode = await compile('CocoonClient');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let root: SandboxContract<TreasuryContract>;
    let cocoonProxy: SandboxContract<CocoonProxy>;
    let defaultParams: Cell;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        root = await blockchain.treasury('root');
            
        const configParams : CocoonParams = {
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
          proxy_sc_code: null,
          worker_sc_code: workerCode,
          client_sc_code: clientCode 
        };

        defaultParams = cocoonParamsToCell(configParams); 

        cocoonProxy = blockchain.openContract(
            CocoonProxy.createFromConfig(
                {
                    ownerAddress: owner.address,
                    proxyPublicKey: 123456789n,
                    rootAddress: root.address,
                    state: 0, // NORMAL
                    balance: 0n,
                    stake: toNano('1'),
                    unlockTs: 0,
                    params: defaultParams,
                },
                code,
            ),
        );

        const deployResult = await cocoonProxy.sendDeploy(deployer.getSender(), toNano('1'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonProxy.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        const data = await cocoonProxy.getData();
        expect(data.ownerAddress.toString()).toBe(owner.address.toString());
        expect(data.state).toBe(0);
        expect(data.balance).toBe(0n);
        expect(data.stake).toBe(toNano('1'));
    });

    it('should have correct initial state', async () => {
        const data = await cocoonProxy.getData();
        expect(data.ownerAddress.toString()).toBe(owner.address.toString());
        expect(data.proxyPublicKey).toBe(123456789n);
        expect(data.rootAddress.toString()).toBe(root.address.toString());
        expect(data.state).toBe(0);
        expect(data.balance).toBe(0n);
        expect(data.stake).toBe(toNano('1'));
        expect(data.unlockTs).toBe(0);
    });

    it('should ignore empty messages', async () => {
        const result = await blockchain.sendMessage({
            info: {
                type: 'internal',
                src: deployer.address,
                dest: cocoonProxy.address,
                value: { coins: toNano('0.1') },
                bounce: true,
                bounced: false,
                ihrDisabled: true,
                createdAt: 0,
                createdLt: 0n,
                ihrFee: 0n,
                forwardFee: 0n,
            },
            body: beginCell().endCell(),
        });

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonProxy.address,
            success: true,
        });
    });

    it('should ignore OP_DO_NOT_PROCESS', async () => {
        const result = await blockchain.sendMessage({
            info: {
                type: 'internal',
                src: deployer.address,
                dest: cocoonProxy.address,
                value: { coins: toNano('0.1') },
                bounce: true,
                bounced: false,
                ihrDisabled: true,
                createdAt: 0,
                createdLt: 0n,
                ihrFee: 0n,
                forwardFee: 0n,
            },
            body: beginCell().storeUint(OP_DO_NOT_PROCESS, 32).endCell(),
        });

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonProxy.address,
            success: true,
        });
    });

    describe('ext_proxy_payout_request', () => {
        it('should withdraw balance', async () => {
            // First, add some balance
            await blockchain.sendMessage({
                info: {
                    type: 'internal',
                    src: deployer.address,
                    dest: cocoonProxy.address,
                    value: { coins: toNano('5') },
                    bounce: true,
                    bounced: false,
                    ihrDisabled: true,
                    createdAt: 0,
                    createdLt: 0n,
                    ihrFee: 0n,
                    forwardFee: 0n,
                },
                body: beginCell().endCell(),
            });

            // Set balance in contract (simulating worker payout)
            // For now, just test the message handling
            const result = await cocoonProxy.sendExtProxyPayoutRequest(deployer.getSender(), {
                value: toNano('0.1'),
                sendExcessesTo: deployer.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonProxy.address,
                success: true,
            });
        });
    });

    describe('ext_proxy_increase_stake', () => {
        it('should increase stake (note: FunC has bug swapping balance/stake)', async () => {
            const result = await cocoonProxy.sendExtProxyIncreaseStake(deployer.getSender(), {
                value: toNano('2'),
                grams: toNano('1'),
                sendExcessesTo: deployer.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonProxy.address,
                success: true,
            });

            const data = await cocoonProxy.getData();
            
            expect(data.stake).toBe(toNano('2')); // Correctly updates stake (1 initial + 1 added)
            expect(data.balance).toBe(toNano('0')); // Balance remains 0
        });

        it('should fail with low value', async () => {
            const result = await cocoonProxy.sendExtProxyIncreaseStake(deployer.getSender(), {
                value: toNano('0.5'),
                grams: toNano('1'),
                sendExcessesTo: deployer.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonProxy.address,
                success: false,
            });
        });
    });

    describe('owner_proxy_close', () => {
        it('should close proxy from normal state', async () => {
            const result = await cocoonProxy.sendOwnerProxyClose(owner.getSender(), {
                value: toNano('0.1'),
                sendExcessesTo: owner.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: true,
            });

            const data = await cocoonProxy.getData();
            expect(data.state).toBe(1); // CLOSING
            expect(data.unlockTs).toBeGreaterThan(0);
        });

        it('should fail from non-owner', async () => {
            const result = await cocoonProxy.sendOwnerProxyClose(deployer.getSender(), {
                value: toNano('0.1'),
                sendExcessesTo: deployer.address,
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonProxy.address,
                success: false,
            });
        });
    });

    describe('text commands', () => {
        it('should close proxy with "c" command', async () => {
            const result = await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: true,
            });

            const data = await cocoonProxy.getData();
            expect(data.state).toBe(1); // CLOSING
        });

        it('should withdraw with "w" command', async () => {
            const result = await cocoonProxy.sendTextWithdraw(owner.getSender(), toNano('0.1'));

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: cocoonProxy.address,
                success: true,
            });
        });

        it('should fail "c" from non-owner', async () => {
            const result = await cocoonProxy.sendTextClose(deployer.getSender(), toNano('0.1'));

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: cocoonProxy.address,
                success: false,
            });
        });
    });

    it('should fail with unknown opcode', async () => {
        const result = await blockchain.sendMessage({
            info: {
                type: 'internal',
                src: deployer.address,
                dest: cocoonProxy.address,
                value: { coins: toNano('0.1') },
                bounce: true,
                bounced: false,
                ihrDisabled: true,
                createdAt: 0,
                createdLt: 0n,
                ihrFee: 0n,
                forwardFee: 0n,
            },
            body: beginCell()
                .storeUint(999999, 32) // Unknown opcode
                .storeUint(0, 64) // query_id
                .endCell(),
        });

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: cocoonProxy.address,
            success: false,
        });
    });
});
