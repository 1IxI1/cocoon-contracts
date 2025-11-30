import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, beginCell, Cell, toNano } from '@ton/core';
import { CocoonProxy } from '../wrappers/CocoonProxy';
import { CocoonWorker } from '../wrappers/CocoonWorker';
import { CocoonClient } from '../wrappers/CocoonClient';
import { CocoonWallet } from '../wrappers/CocoonWallet';
import { CocoonParams, cocoonParamsToCell } from '../wrappers/CocoonRoot';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { KeyPair } from '@ton/crypto';
import { TestKeyPairs, TestConstants, createDefaultParams } from './helpers/fixtures';

// Helper to format TON values (auto-adjust decimals for small values)
const formatTon = (n: bigint) => {
    const val = Number(n) / 1e9;
    if (val === 0) return '0';
    if (Math.abs(val) < 0.0001) return val.toExponential(2);
    if (Math.abs(val) < 0.01) return val.toFixed(6);
    return val.toFixed(3);
};
const formatDiff = (before: bigint, after: bigint) => {
    const diff = after - before;
    const sign = diff >= 0n ? '+' : '';
    return `${sign}${formatTon(diff)}`;
};

describe('Integration - Full Lifecycle', () => {
    // Compiled codes
    let proxyCode: Cell;
    let workerCode: Cell;
    let clientCode: Cell;

    // Keypair for proxy signing
    let proxyKeyPair: KeyPair;
    let proxyPublicKey: bigint;

    // Params cells
    let paramsWithCodes: Cell;      // For proxy (has codes embedded)
    let paramsWithoutCodes: Cell;   // For worker/client (no codes - used for address calculation)
    let minClientStake: bigint;

    // Pricing constants - shared across all tests
    const PRICE_PER_TOKEN = toNano('0.00001');       // 0.00001 TON per token
    const WORKER_FEE_PER_TOKEN = toNano('0.000009'); // Worker gets 90% of price

    beforeAll(async () => {
        proxyCode = await compile('CocoonProxy');
        workerCode = await compile('CocoonWorker');
        clientCode = await compile('CocoonClient');
        proxyKeyPair = TestKeyPairs.PROXY_KEYPAIR;
        proxyPublicKey = BigInt('0x' + proxyKeyPair.publicKey.toString('hex'));

        const baseParams = createDefaultParams();
        minClientStake = baseParams.min_client_stake;

        // Params WITH codes - for proxy (using custom pricing)
        const configParams: CocoonParams = {
            ...baseParams,
            price_per_token: PRICE_PER_TOKEN,
            worker_fee_per_token: WORKER_FEE_PER_TOKEN,
            proxy_delay_before_close: 3600,
            client_delay_before_close: 3600,
            worker_sc_code: workerCode,
            client_sc_code: clientCode,
        };
        paramsWithCodes = cocoonParamsToCell(configParams);

        // Params WITHOUT codes - for worker/client address calculation
        paramsWithoutCodes = cocoonParamsToCell({
            ...configParams,
            worker_sc_code: null,
            client_sc_code: null,
            proxy_sc_code: null,
        });
    });

    let blockchain: Blockchain;
    let proxyOwner: SandboxContract<TreasuryContract>;
    let workerOwner: SandboxContract<TreasuryContract>;
    let clientOwner: SandboxContract<TreasuryContract>;
    let root: SandboxContract<TreasuryContract>;

    let cocoonProxy: SandboxContract<CocoonProxy>;
    let cocoonWorker: SandboxContract<CocoonWorker>;
    let cocoonClient: SandboxContract<CocoonClient>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        // Create different owners for each contract
        proxyOwner = await blockchain.treasury('proxyOwner');
        workerOwner = await blockchain.treasury('workerOwner');
        clientOwner = await blockchain.treasury('clientOwner');
        root = await blockchain.treasury('root');
    });

    it('should measure realistic usage with CocoonWallet', async () => {
        // Realistic pattern:
        // 1. Most frequent: Proxy's CocoonWallet sends "save state" messages (do_not_process)
        // 2. Less frequent: Workers withdraw earnings, clients pay
        // 3. Rare: Client top-ups
        
        const SAVE_STATE_MESSAGES = 100;      // Proxy saves state 100 times
        const WORKER_WITHDRAWALS = 5;         // Workers withdraw 5 times
        const CLIENT_CHARGES = 5;             // Clients charged 5 times
        const CLIENT_TOPUPS = 2;              // Clients top up 2 times
        const TOKENS_PER_CYCLE = 100000n;     // 100K tokens per cycle (realistic for LLM queries)

        // Import CocoonWallet
        const walletCode = await compile('CocoonWallet');

        // ============================================================
        // SETUP: Deploy contracts
        // ============================================================
        
        // Deploy CocoonWallet for proxy operator
        const proxyWallet = blockchain.openContract(
            CocoonWallet.createFromConfig({
                publicKey: proxyKeyPair.publicKey,
                ownerAddress: proxyOwner.address,
            }, walletCode)
        );
        await proxyWallet.sendDeploy(proxyOwner.getSender(), toNano('5'));

        // Deploy Proxy (owner is proxyOwner's regular wallet, NOT the CocoonWallet)
        cocoonProxy = blockchain.openContract(
            CocoonProxy.createFromConfig({
                ownerAddress: proxyOwner.address,
                proxyPublicKey,
                rootAddress: root.address,
                state: TestConstants.STATE_NORMAL,
                balance: 0n,
                stake: toNano('10'),
                unlockTs: 0,
                params: paramsWithCodes,
            }, proxyCode)
        );
        await cocoonProxy.sendDeploy(proxyOwner.getSender(), toNano('11'));

        // Deploy Worker (owner is workerOwner's regular wallet)
        cocoonWorker = blockchain.openContract(
            CocoonWorker.createFromConfig({
                ownerAddress: workerOwner.address,
                proxyAddress: cocoonProxy.address,
                proxyPublicKey,
                state: TestConstants.STATE_NORMAL,
                tokens: 0n,
                params: paramsWithoutCodes,
            }, workerCode)
        );
        await cocoonWorker.sendDeploy(workerOwner.getSender(), toNano('2'));

        // Deploy Client (owner is clientOwner's regular wallet)
        cocoonClient = blockchain.openContract(
            CocoonClient.createFromConfig({
                ownerAddress: clientOwner.address,
                proxyAddress: cocoonProxy.address,
                proxyPublicKey,
                state: TestConstants.STATE_NORMAL,
                balance: 0n,
                stake: minClientStake,
                tokensUsed: 0n,
                unlockTs: 0,
                secretHash: 0n,
                params: paramsWithoutCodes,
            }, clientCode)
        );
        await cocoonClient.sendDeploy(clientOwner.getSender(), toNano('6'));
        
        // Initial client top-up - deposit enough to cover usage
        // Total tokens = SAVE_STATE_MESSAGES × TOKENS_PER_CYCLE = 10,000,000 tokens
        // Cost = 10,000,000 × 0.00001 = 100 TON
        const totalTokensExpected = BigInt(SAVE_STATE_MESSAGES) * TOKENS_PER_CYCLE;
        const requiredDeposit = totalTokensExpected * PRICE_PER_TOKEN;  // in nanoTON
        await cocoonClient.sendExtTopUp(clientOwner.getSender(), requiredDeposit + toNano('10'), requiredDeposit, clientOwner.address);

        // Capture balances after setup
        const balancesAfterSetup = {
            proxyOwner: await proxyOwner.getBalance(),
            workerOwner: await workerOwner.getBalance(),
            clientOwner: await clientOwner.getBalance(),
            proxyWallet: (await blockchain.getContract(proxyWallet.address)).balance,
            proxy: (await blockchain.getContract(cocoonProxy.address)).balance,
            worker: (await blockchain.getContract(cocoonWorker.address)).balance,
            client: (await blockchain.getContract(cocoonClient.address)).balance,
        };

        // ============================================================
        // PHASE 1: Save state messages (most frequent)
        // Proxy's CocoonWallet sends external messages with "do_not_process" to Proxy
        // ============================================================
        const OP_DO_NOT_PROCESS = 0x9a1247c0;
        
        for (let i = 0; i < SAVE_STATE_MESSAGES; i++) {
            const saveStateMsg = beginCell()
                .storeUint(OP_DO_NOT_PROCESS, 32)
                .storeUint(BigInt(Date.now() + i), 64)  // query_id
                .storeUint(0x12345678, 32)              // proxy_save_state opcode (ignored)
                .storeUint(i, 32)                       // seqno
                .endCell();
            
            await proxyWallet.sendExternalSigned(
                [{ to: cocoonProxy.address, value: 1n, body: saveStateMsg }],
                proxyKeyPair,
                { seqno: i }
            );
        }

        const balancesAfterSaveState = {
            proxyOwner: await proxyOwner.getBalance(),
            proxyWallet: (await blockchain.getContract(proxyWallet.address)).balance,
        };
        // External messages are paid from wallet's balance
        const saveStateGas = balancesAfterSetup.proxyWallet - balancesAfterSaveState.proxyWallet;

        // ============================================================
        // PHASE 2: Client top-ups (deposits TON to proxy)
        // Must happen BEFORE worker payouts so proxy has funds
        // Additional top-ups = 100 TON each to cover any shortfall
        // ============================================================
        const clientBalanceBeforeTopup = await clientOwner.getBalance();
        const proxyBalanceBeforeTopup = (await blockchain.getContract(cocoonProxy.address)).balance;

        const topupAmount = toNano('100');
        for (let i = 0; i < CLIENT_TOPUPS; i++) {
            await cocoonClient.sendExtTopUp(
                clientOwner.getSender(),
                topupAmount + toNano('5'),
                topupAmount,
                clientOwner.address
            );
        }
        const clientBalanceAfterTopup = await clientOwner.getBalance();
        const proxyBalanceAfterTopup = (await blockchain.getContract(cocoonProxy.address)).balance;
        const clientTopupCost = clientBalanceBeforeTopup - clientBalanceAfterTopup;
        const proxyReceivedFromTopups = proxyBalanceAfterTopup - proxyBalanceBeforeTopup;

        // ============================================================
        // PHASE 3: Client charges (accounting - tracks usage)
        // ============================================================
        const clientBalanceBeforeCharge = await clientOwner.getBalance();
        const tokensPerCharge = TOKENS_PER_CYCLE * BigInt(SAVE_STATE_MESSAGES) / BigInt(CLIENT_CHARGES);

        for (let i = 0; i < CLIENT_CHARGES; i++) {
            await cocoonClient.sendChargeRequest(
                clientOwner.getSender(),
                i + 1,
                tokensPerCharge * BigInt(i + 1),
                cocoonClient.address,
                clientOwner.address,
                proxyKeyPair,
                toNano('0.2')
            );
        }
        const clientBalanceAfterCharge = await clientOwner.getBalance();
        const clientChargeGas = clientBalanceBeforeCharge - clientBalanceAfterCharge;

        // ============================================================
        // PHASE 4: Worker payouts (claims earnings from proxy)
        // Now proxy has funds from client top-ups
        // ============================================================
        const workerBalanceBefore = await workerOwner.getBalance();
        const proxyBalanceBeforePayout = (await blockchain.getContract(cocoonProxy.address)).balance;
        const tokensPerWithdrawal = TOKENS_PER_CYCLE * BigInt(SAVE_STATE_MESSAGES) / BigInt(WORKER_WITHDRAWALS);

        console.log(`Worker payouts: ${WORKER_WITHDRAWALS} x ${tokensPerWithdrawal} tokens`);
        for (let i = 0; i < WORKER_WITHDRAWALS; i++) {
            await cocoonWorker.sendPayoutRequest(
                workerOwner.getSender(),
                i + 1,
                tokensPerWithdrawal * BigInt(i + 1),
                cocoonWorker.address,
                workerOwner.address,
                proxyKeyPair,
                toNano('0.3')
            );
        }
        const workerBalanceAfter = await workerOwner.getBalance();
        const proxyBalanceAfterPayout = (await blockchain.getContract(cocoonProxy.address)).balance;
        const workerNetChange = workerBalanceAfter - workerBalanceBefore;
        const proxyPaidToWorkers = proxyBalanceBeforePayout - proxyBalanceAfterPayout;

        // ============================================================
        // PROXY REVENUE WITHDRAWAL
        // ============================================================
        const proxyOwnerBalanceBeforeWithdraw = await proxyOwner.getBalance();
        await cocoonProxy.sendTextWithdraw(proxyOwner.getSender(), toNano('0.1'));
        const proxyOwnerBalanceAfterWithdraw = await proxyOwner.getBalance();
        const proxyRevenueWithdrawn = proxyOwnerBalanceAfterWithdraw - proxyOwnerBalanceBeforeWithdraw;

        // ============================================================
        // ANALYSIS
        // ============================================================
        const totalTokens = TOKENS_PER_CYCLE * BigInt(SAVE_STATE_MESSAGES);
        const totalTokenCost = totalTokens * PRICE_PER_TOKEN;  // in nanoTON
        const totalWorkerEarnings = totalTokens * WORKER_FEE_PER_TOKEN;  // in nanoTON
        const depositedToProxy = requiredDeposit + topupAmount * BigInt(CLIENT_TOPUPS);
        // Worker gas = what worker spent initiating payouts
        const workerGasCost = proxyPaidToWorkers - workerNetChange;

        // Final balances for all contracts
        const finalBalances = {
            proxyOwner: await proxyOwner.getBalance(),
            workerOwner: await workerOwner.getBalance(),
            clientOwner: await clientOwner.getBalance(),
            proxyWallet: (await blockchain.getContract(proxyWallet.address)).balance,
            proxy: (await blockchain.getContract(cocoonProxy.address)).balance,
            worker: (await blockchain.getContract(cocoonWorker.address)).balance,
            client: (await blockchain.getContract(cocoonClient.address)).balance,
        };

        console.log(`
=== REALISTIC USAGE WITH COCOON WALLET ===

Scenario:
  ${SAVE_STATE_MESSAGES} save state messages (proxy → blockchain)
  ${CLIENT_TOPUPS} client top-ups (deposit TON)
  ${CLIENT_CHARGES} client charges (track usage)
  ${WORKER_WITHDRAWALS} worker payouts (claim earnings)

Token Economics:
  Price per token:       ${formatTon(PRICE_PER_TOKEN)} TON
  Worker fee per token:  ${formatTon(WORKER_FEE_PER_TOKEN)} TON (${Number(WORKER_FEE_PER_TOKEN * 100n / PRICE_PER_TOKEN)}%)
  Total tokens:          ${totalTokens}
  Total cost (tokens):   ${formatTon(totalTokenCost)} TON
  Expected worker earn:  ${formatTon(totalWorkerEarnings)} TON

Money Flow:
  Initial deposit:       ${formatTon(requiredDeposit)} TON
  Additional top-ups:    ${formatTon(topupAmount * BigInt(CLIENT_TOPUPS))} TON (${CLIENT_TOPUPS} × ${formatTon(topupAmount)})
  Proxy received:        ${formatTon(proxyReceivedFromTopups)} TON
  Proxy paid workers:    ${formatTon(proxyPaidToWorkers)} TON
  Proxy revenue:         ${formatDiff(0n, proxyRevenueWithdrawn)} TON (withdrawn to owner)
  Worker gas cost:       ${formatTon(workerGasCost)} TON
  Worker net earnings:   ${formatDiff(0n, workerNetChange)} TON

Gas Costs Per Operation:
  Save state:    ~${formatTon(saveStateGas / BigInt(SAVE_STATE_MESSAGES))} each
  Client top-up: ~${formatTon((clientTopupCost - topupAmount * BigInt(CLIENT_TOPUPS)) / BigInt(CLIENT_TOPUPS))} each
  Client charge: ~${formatTon(clientChargeGas / BigInt(CLIENT_CHARGES))} each
  Worker payout: ~${formatTon(workerGasCost / BigInt(WORKER_WITHDRAWALS))} each

Contract Balance Changes:
  CocoonProxy:  ${formatDiff(balancesAfterSetup.proxy, finalBalances.proxy)} (${formatTon(finalBalances.proxy)})
  CocoonWorker: ${formatDiff(balancesAfterSetup.worker, finalBalances.worker)} (${formatTon(finalBalances.worker)})
  CocoonClient: ${formatDiff(balancesAfterSetup.client, finalBalances.client)} (${formatTon(finalBalances.client)})
  ProxyWallet:  ${formatDiff(balancesAfterSetup.proxyWallet, finalBalances.proxyWallet)} (${formatTon(finalBalances.proxyWallet)})

Owner Balance Changes:
  proxyOwner:  ${formatDiff(balancesAfterSetup.proxyOwner, finalBalances.proxyOwner)}
  workerOwner: ${formatDiff(balancesAfterSetup.workerOwner, finalBalances.workerOwner)}
  clientOwner: ${formatDiff(balancesAfterSetup.clientOwner, finalBalances.clientOwner)}
`);

        // Verify contracts still work
        expect((await cocoonProxy.getData()).state).toBe(TestConstants.STATE_NORMAL);
        expect((await cocoonWorker.getData()).state).toBe(TestConstants.STATE_NORMAL);
        expect((await cocoonClient.getData()).state).toBe(TestConstants.STATE_NORMAL);
    });
});
