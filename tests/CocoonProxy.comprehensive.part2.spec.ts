import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { CocoonProxy, CocoonProxyTest, CocoonProxyTestContext } from '../wrappers/CocoonProxy';
import { CocoonParams, cocoonParamsToCell } from '../wrappers/CocoonRoot';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { TestKeyPairs, TestConstants, createDefaultParams, closeProxyFully } from './helpers/fixtures';

describe('CocoonProxy - Comprehensive (Part 2: Inter-Contract Messages & Getters)', () => {
    let code: Cell;
    let workerCode: Cell;
    let clientCode: Cell;
    let defaultParams: Cell;
    let paramsWithoutCodes: Cell;
    let minClientStake: bigint;
    let proxyPublicKey: bigint;

    beforeAll(async () => {
        code = await compile('CocoonProxy');
        workerCode = await compile('CocoonWorker');
        clientCode = await compile('CocoonClient');

        const baseParams = createDefaultParams();
        minClientStake = baseParams.min_client_stake;
        proxyPublicKey = BigInt('0x' + TestKeyPairs.PROXY_KEYPAIR.publicKey.toString('hex'));

        const configParams: CocoonParams = {
            ...baseParams,
            proxy_delay_before_close: 7200,
            worker_sc_code: workerCode,
            client_sc_code: clientCode,
        };

        defaultParams = cocoonParamsToCell(configParams);

        // Params without codes - used for address calculation
        paramsWithoutCodes = cocoonParamsToCell({
            ...configParams,
            worker_sc_code: null,
            client_sc_code: null,
            proxy_sc_code: null,
        });
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let owner: SandboxContract<TreasuryContract>;
    let root: SandboxContract<TreasuryContract>;
    let cocoonProxy: SandboxContract<CocoonProxy>;
    let testCtx: CocoonProxyTestContext;
    let keyPair = TestKeyPairs.PROXY_KEYPAIR;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        owner = await blockchain.treasury('owner');
        root = await blockchain.treasury('root');

        cocoonProxy = blockchain.openContract(
            CocoonProxy.createFromConfig(
                {
                    ownerAddress: owner.address,
                    proxyPublicKey,
                    rootAddress: root.address,
                    state: TestConstants.STATE_NORMAL,
                    balance: toNano('5'),
                    stake: toNano('10'),
                    unlockTs: 0,
                    params: defaultParams,
                },
                code
            )
        );

        await cocoonProxy.sendDeploy(deployer.getSender(), toNano('20'));

        // Create test context for inter-contract message simulation
        testCtx = {
            blockchain,
            proxy: cocoonProxy,
            workerCode,
            clientCode,
            paramsWithoutCodes,
            proxyPublicKey,
            minClientStake,
        };
    });

    describe('WorkerProxyRequest Messages', () => {
        it('should handle valid WorkerProxyRequest with payout', async () => {
            const workerPart = toNano('1');
            const proxyPart = toNano('0.5');

            const dataBefore = await cocoonProxy.getData();

            const result = await CocoonProxyTest.sendWorkerProxyRequest(testCtx, owner.address, {
                value: toNano('2'),
                payload: { workerPart, proxyPart, sendExcessesTo: owner.address },
            });

            expect(result.transactions).toHaveTransaction({
                to: cocoonProxy.address,
                success: true,
            });

            // Verify payout sent to worker owner
            expect(result.transactions).toHaveTransaction({
                from: cocoonProxy.address,
                to: owner.address,
                op: TestConstants.OP_PAYOUT,
                success: true,
            });

            // Verify proxy balance increased
            const dataAfter = await cocoonProxy.getData();
            expect(dataAfter.balance).toBe(dataBefore.balance + proxyPart);
        });

        it('should handle WorkerProxyRequest with empty payload (no-op)', async () => {
            const result = await CocoonProxyTest.sendWorkerProxyRequest(testCtx, owner.address, {
                value: toNano('0.2'),
            });

            // Should succeed but do nothing
            expect(result.transactions).toHaveTransaction({
                to: cocoonProxy.address,
                success: true,
            });
        });

        it('should reject WorkerProxyRequest from wrong worker address', async () => {
            const fakeWorker = await blockchain.treasury('fakeWorker');

            // Must include payload to trigger address check (null payload returns early)
            const result = await CocoonProxyTest.sendWorkerProxyRequest(testCtx, owner.address, {
                from: fakeWorker.address,
                value: toNano('2'),
                payload: { workerPart: toNano('0.1'), proxyPart: toNano('0.1'), sendExcessesTo: owner.address },
            });

            expect(result.transactions).toHaveTransaction({
                from: fakeWorker.address,
                to: cocoonProxy.address,
                success: false,
                exitCode: TestConstants.ERROR_CONTRACT_ADDRESS_MISMATCH,
            });
        });

        it('should reject WorkerProxyRequest if proxy is closed', async () => {
            // Close fully
            await closeProxyFully(cocoonProxy, owner, blockchain, keyPair);

            // Must include payload to reach the CLOSED check
            const result = await CocoonProxyTest.sendWorkerProxyRequest(testCtx, owner.address, {
                value: toNano('2'),
                payload: { workerPart: toNano('0.1'), proxyPart: toNano('0.1'), sendExcessesTo: owner.address },
            });

            expect(result.transactions).toHaveTransaction({
                to: cocoonProxy.address,
                success: false,
                exitCode: TestConstants.ERROR_CLOSED,
            });
        });
    });

    describe('ClientProxyRequest Messages', () => {
        describe('ClientProxyTopUp (0x5cfc6b87)', () => {
            it('should accept top-up when proxy is NORMAL', async () => {
                const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                    value: toNano('3'),
                    topUp: { coins: toNano('2'), sendExcessesTo: owner.address },
                });

                expect(result.transactions).toHaveTransaction({
                    to: cocoonProxy.address,
                    success: true,
                });
            });

            it('should return funds when proxy is not NORMAL', async () => {
                // Close proxy
                await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));

                const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                    value: toNano('3'),
                    topUp: { coins: toNano('2'), sendExcessesTo: owner.address },
                });

                expect(result.transactions).toHaveTransaction({
                    to: cocoonProxy.address,
                    success: true,
                });

                // Verify payout sent back (returning the top-up)
                expect(result.transactions).toHaveTransaction({
                    from: cocoonProxy.address,
                    to: owner.address,
                    op: TestConstants.OP_PAYOUT,
                    success: true,
                });
            });
        });

        describe('ClientProxyRegister (0xa35cb580)', () => {
            it('should handle register request (no-op)', async () => {
                const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                    value: toNano('0.2'),
                    register: true,
                });

                // Should succeed and do nothing
                expect(result.transactions).toHaveTransaction({
                    to: cocoonProxy.address,
                    success: true,
                });
            });
        });

        describe('ClientProxyRefundGranted (0xc68ebc7b)', () => {
            it('should process refund granted', async () => {
                const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                    value: toNano('4'),
                    refundGranted: { coins: toNano('3'), sendExcessesTo: owner.address },
                });

                expect(result.transactions).toHaveTransaction({
                    to: cocoonProxy.address,
                    success: true,
                });

                // Verify payout sent
                expect(result.transactions).toHaveTransaction({
                    from: cocoonProxy.address,
                    to: owner.address,
                    op: TestConstants.OP_PAYOUT,
                    success: true,
                });
            });

            it('should reject refund granted if proxy is closed', async () => {
                // Close fully
                await closeProxyFully(cocoonProxy, owner, blockchain, keyPair);

                const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                    value: toNano('4'),
                    refundGranted: { coins: toNano('3'), sendExcessesTo: owner.address },
                });

                expect(result.transactions).toHaveTransaction({
                    to: cocoonProxy.address,
                    success: false,
                    exitCode: TestConstants.ERROR_CLOSED,
                });
            });
        });

        describe('ClientProxyRefundForce (0xf4c354c9)', () => {
            it('should process forced refund (full amount from stake)', async () => {
                const refundCoins = toNano('5');
                const dataBefore = await cocoonProxy.getData();

                const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                    value: toNano('6'),
                    refundForce: { coins: refundCoins, sendExcessesTo: owner.address },
                });

                expect(result.transactions).toHaveTransaction({
                    to: cocoonProxy.address,
                    success: true,
                });

                // Verify stake reduced
                const dataAfter = await cocoonProxy.getData();
                expect(dataAfter.stake).toBe(dataBefore.stake - refundCoins);
            });

            it('should process partial refund if requested > stake', async () => {
                const requestedRefund = toNano('20'); // More than stake

                const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                    value: toNano('21'),
                    refundForce: { coins: requestedRefund, sendExcessesTo: owner.address },
                });

                expect(result.transactions).toHaveTransaction({
                    to: cocoonProxy.address,
                    success: true,
                });

                // Verify stake reduced to 0 (all stake refunded)
                const dataAfter = await cocoonProxy.getData();
                expect(dataAfter.stake).toBe(0n);
            });
        });

        it('should reject ClientProxyRequest from wrong client address', async () => {
            const fakeClient = await blockchain.treasury('fakeClient');

            // Must include payload to trigger address check (null payload returns early)
            const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                from: fakeClient.address,
                value: toNano('2'),
                topUp: { coins: toNano('1'), sendExcessesTo: owner.address },
            });

            expect(result.transactions).toHaveTransaction({
                from: fakeClient.address,
                to: cocoonProxy.address,
                success: false,
                exitCode: TestConstants.ERROR_CONTRACT_ADDRESS_MISMATCH,
            });
        });

        it('should handle ClientProxyRequest with empty payload (no-op)', async () => {
            const result = await CocoonProxyTest.sendClientProxyRequest(testCtx, owner.address, {
                value: toNano('0.2'),
            });

            // Should succeed but do nothing
            expect(result.transactions).toHaveTransaction({
                to: cocoonProxy.address,
                success: true,
            });
        });
    });

    describe('Getters', () => {
        it('should return correct get_cocoon_proxy_data', async () => {
            const data = await cocoonProxy.getData();

            // Verify all 12 fields
            expect(data.ownerAddress.toString()).toBe(owner.address.toString());
            expect(data.proxyPublicKey).toBe(BigInt('0x' + keyPair.publicKey.toString('hex')));
            expect(data.rootAddress.toString()).toBe(root.address.toString());
            expect(data.state).toBe(TestConstants.STATE_NORMAL);
            expect(data.balance).toBe(toNano('5'));
            expect(data.stake).toBe(toNano('10'));
            expect(data.unlockTs).toBe(0);
            expect(data.pricePerToken).toBeGreaterThanOrEqual(0);
            expect(data.workerFeePerToken).toBeGreaterThanOrEqual(0);
            expect(data.minProxyStake).toBeGreaterThanOrEqual(0n);
            expect(data.minClientStake).toBeGreaterThanOrEqual(0n);
            expect(data.paramsVersion).toBeGreaterThanOrEqual(0);
        });

        it('should reflect state changes in getter', async () => {
            // Close to CLOSING
            await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));
            let data = await cocoonProxy.getData();
            expect(data.state).toBe(TestConstants.STATE_CLOSING);
            expect(data.unlockTs).toBeGreaterThan(0);

            // Complete close via signed message
            blockchain.now = Math.floor(Date.now() / 1000) + 7300;
            await cocoonProxy.sendCloseComplete(owner.getSender(), {
                value: toNano('0.2'),
                sendExcessesTo: owner.address,
                keyPair,
            });
            expect(await cocoonProxy.getData()).toMatchObject({
                state: TestConstants.STATE_CLOSED,
                balance: 0n,
                stake: 0n,
            });
        });
    });
});

