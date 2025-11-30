import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { sign, KeyPair } from '@ton/crypto';
import { Blockchain, internal, SandboxContract } from '@ton/sandbox';
import { cocoonWorkerConfigToCell } from './CocoonWorker';
import { cocoonClientConfigToCell } from './CocoonClient';

// Opcodes - External messages
const OP_EXT_PROXY_PAYOUT_REQUEST = 0x7610e6eb;
const OP_EXT_PROXY_INCREASE_STAKE = 0x9713f187;
const OP_OWNER_PROXY_CLOSE = 0xb51d5a01;
const OP_CLOSE_REQUEST = 0x636a4391;
const OP_CLOSE_COMPLETE = 0xe511abc7;

// Opcodes - Inter-contract messages
const OP_WORKER_PROXY_REQUEST = 0x4d725d2c;
const OP_WORKER_PROXY_PAYOUT_REQUEST = 0x08e7d036;
const OP_CLIENT_PROXY_REQUEST = 0x65448ff4;
const OP_CLIENT_PROXY_TOP_UP = 0x5cfc6b87;
const OP_CLIENT_PROXY_REGISTER = 0xa35cb580;
const OP_CLIENT_PROXY_REFUND_GRANTED = 0xc68ebc7b;
const OP_CLIENT_PROXY_REFUND_FORCE = 0xf4c354c9;

/**
 * Test context for simulating inter-contract messages.
 * Created once in test setup and reused for all _test* methods.
 */
export type CocoonProxyTestContext = {
    blockchain: Blockchain;
    proxy: SandboxContract<CocoonProxy>;
    workerCode: Cell;
    clientCode: Cell;
    paramsWithoutCodes: Cell;
    proxyPublicKey: bigint;
    minClientStake: bigint;
};

/**
 * Simple test helpers using context. Prefix _test indicates test-only.
 */
export const CocoonProxyTest = {
    /**
     * Send WorkerProxyRequest. If `from` not provided, calculates correct worker address.
     */
    sendWorkerProxyRequest(ctx: CocoonProxyTestContext, ownerAddress: Address, opts?: {
        from?: Address;  // If provided, use this address (for wrong address testing)
        value?: bigint;
        payload?: { workerPart: bigint; proxyPart: bigint; sendExcessesTo: Address };
    }) {
        const fromAddress = opts?.from ?? CocoonProxy.calculateWorkerAddress(
            ctx.workerCode,
            ctx.proxy.address,
            ctx.proxyPublicKey,
            ownerAddress,
            ctx.paramsWithoutCodes
        );

        let payloadCell: Cell | null = null;
        if (opts?.payload) {
            payloadCell = beginCell()
                .storeUint(OP_WORKER_PROXY_PAYOUT_REQUEST, 32)
                .storeCoins(opts.payload.workerPart)
                .storeCoins(opts.payload.proxyPart)
                .storeAddress(opts.payload.sendExcessesTo)
                .endCell();
        }

        const body = beginCell()
            .storeUint(OP_WORKER_PROXY_REQUEST, 32)
            .storeUint(0, 64)
            .storeAddress(ownerAddress)
            .storeUint(0, 2)
            .storeUint(0, 64)
            .storeMaybeRef(payloadCell)
            .endCell();

        return ctx.blockchain.sendMessage(internal({
            from: fromAddress,
            to: ctx.proxy.address,
            value: opts?.value ?? 1000000000n,
            body,
        }));
    },

    /**
     * Send ClientProxyRequest. If `from` not provided, calculates correct client address.
     */
    sendClientProxyRequest(ctx: CocoonProxyTestContext, ownerAddress: Address, opts?: {
        from?: Address;  // If provided, use this address (for wrong address testing)
        value?: bigint;
        topUp?: { coins: bigint; sendExcessesTo: Address };
        register?: boolean;
        refundGranted?: { coins: bigint; sendExcessesTo: Address };
        refundForce?: { coins: bigint; sendExcessesTo: Address };
    }) {
        const fromAddress = opts?.from ?? CocoonProxy.calculateClientAddress(
            ctx.clientCode,
            ctx.proxy.address,
            ctx.proxyPublicKey,
            ownerAddress,
            ctx.paramsWithoutCodes,
            ctx.minClientStake
        );

        let payloadCell: Cell | null = null;
        if (opts?.topUp) {
            payloadCell = beginCell()
                .storeUint(OP_CLIENT_PROXY_TOP_UP, 32)
                .storeCoins(opts.topUp.coins)
                .storeAddress(opts.topUp.sendExcessesTo)
                .endCell();
        } else if (opts?.register) {
            payloadCell = beginCell()
                .storeUint(OP_CLIENT_PROXY_REGISTER, 32)
                .endCell();
        } else if (opts?.refundGranted) {
            payloadCell = beginCell()
                .storeUint(OP_CLIENT_PROXY_REFUND_GRANTED, 32)
                .storeCoins(opts.refundGranted.coins)
                .storeAddress(opts.refundGranted.sendExcessesTo)
                .endCell();
        } else if (opts?.refundForce) {
            payloadCell = beginCell()
                .storeUint(OP_CLIENT_PROXY_REFUND_FORCE, 32)
                .storeCoins(opts.refundForce.coins)
                .storeAddress(opts.refundForce.sendExcessesTo)
                .endCell();
        }

        const stateDataCell = beginCell()
            .storeUint(0, 2)
            .storeCoins(0n)
            .storeCoins(ctx.minClientStake)
            .storeUint(0, 64)
            .storeUint(0, 256)
            .endCell();

        const body = beginCell()
            .storeUint(OP_CLIENT_PROXY_REQUEST, 32)
            .storeUint(0, 64)
            .storeAddress(ownerAddress)
            .storeRef(stateDataCell)
            .storeMaybeRef(payloadCell)
            .endCell();

        return ctx.blockchain.sendMessage(internal({
            from: fromAddress,
            to: ctx.proxy.address,
            value: opts?.value ?? 1000000000n,
            body,
        }));
    },
};

export type CocoonProxyConfig = {
    ownerAddress: Address;
    proxyPublicKey: bigint;
    rootAddress: Address;
    state: number;
    balance: bigint;
    stake: bigint;
    unlockTs: number;
    params: Cell;
};

export function cocoonProxyConfigToCell(config: CocoonProxyConfig): Cell {
    return beginCell()
        .storeAddress(config.ownerAddress)
        .storeUint(config.proxyPublicKey, 256)
        .storeAddress(config.rootAddress)
        .storeUint(config.state, 2)
        .storeCoins(config.balance)
        .storeCoins(config.stake)
        .storeUint(config.unlockTs, 32)
        .storeRef(config.params)
        .endCell();
}

export class CocoonProxy implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new CocoonProxy(address);
    }

    static createFromConfig(config: CocoonProxyConfig, code: Cell, workchain = 0) {
        const data = cocoonProxyConfigToCell(config);
        const init = { code, data };
        return new CocoonProxy(contractAddress(workchain, init), init);
    }

    /**
     * Calculate the expected worker address for a given owner.
     * This mirrors the contract's calculateContractAddress logic.
     */
    static calculateWorkerAddress(
        workerCode: Cell,
        proxyAddress: Address,
        proxyPublicKey: bigint,
        ownerAddress: Address,
        paramsWithoutCodes: Cell,
        workchain = 0
    ): Address {
        const workerData = cocoonWorkerConfigToCell({
            ownerAddress,
            proxyAddress,
            proxyPublicKey,
            state: 0,       // worker_state_normal
            tokens: 0n,     // initial tokens = 0
            params: paramsWithoutCodes,
        });
        return contractAddress(workchain, { code: workerCode, data: workerData });
    }

    /**
     * Calculate the expected client address for a given owner.
     * This mirrors the contract's calculateContractAddress logic.
     */
    static calculateClientAddress(
        clientCode: Cell,
        proxyAddress: Address,
        proxyPublicKey: bigint,
        ownerAddress: Address,
        paramsWithoutCodes: Cell,
        minClientStake: bigint,
        workchain = 0
    ): Address {
        const clientData = cocoonClientConfigToCell({
            ownerAddress,
            proxyAddress,
            proxyPublicKey,
            state: 0,                // client_state_normal
            balance: 0n,             // initial balance = 0
            stake: minClientStake,   // initial stake = minClientStake from params
            tokensUsed: 0n,          // initial tokensUsed = 0
            unlockTs: 0,             // initial unlockTs = 0
            secretHash: 0n,          // initial secretHash = 0
            params: paramsWithoutCodes,
        });
        return contractAddress(workchain, { code: clientCode, data: clientData });
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async getData(provider: ContractProvider) {
        const result = await provider.get('get_cocoon_proxy_data', []);
        return {
            ownerAddress: result.stack.readAddress(),
            proxyPublicKey: result.stack.readBigNumber(),
            rootAddress: result.stack.readAddress(),
            state: result.stack.readNumber(),
            balance: result.stack.readBigNumber(),
            stake: result.stack.readBigNumber(),
            unlockTs: result.stack.readNumber(),
            pricePerToken: result.stack.readNumber(),
            workerFeePerToken: result.stack.readNumber(),
            minProxyStake: result.stack.readBigNumber(),
            minClientStake: result.stack.readBigNumber(),
            paramsVersion: result.stack.readNumber(),
        };
    }

    async sendExtProxyPayoutRequest(provider: ContractProvider, via: Sender, opts: {
        value: bigint;
        queryId?: bigint;
        sendExcessesTo: Address;
    }) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP_EXT_PROXY_PAYOUT_REQUEST, 32)
                .storeUint(opts.queryId ?? 0n, 64)
                .storeAddress(opts.sendExcessesTo)
                .endCell(),
        });
    }

    async sendExtProxyIncreaseStake(provider: ContractProvider, via: Sender, opts: {
        value: bigint;
        queryId?: bigint;
        grams: bigint;
        sendExcessesTo: Address;
    }) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP_EXT_PROXY_INCREASE_STAKE, 32)
                .storeUint(opts.queryId ?? 0n, 64)
                .storeCoins(opts.grams)
                .storeAddress(opts.sendExcessesTo)
                .endCell(),
        });
    }

    async sendOwnerProxyClose(provider: ContractProvider, via: Sender, opts: {
        value: bigint;
        queryId?: bigint;
        sendExcessesTo: Address;
    }) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP_OWNER_PROXY_CLOSE, 32)
                .storeUint(opts.queryId ?? 0n, 64)
                .storeAddress(opts.sendExcessesTo)
                .endCell(),
        });
    }

    async sendTextClose(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0, 32) // op = 0 for text commands
                .storeUint(99, 8) // "c" = 99 in ASCII
                .endCell(),
        });
    }

    async sendTextWithdraw(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(0, 32) // op = 0 for text commands
                .storeUint(119, 8) // "w" = 119 in ASCII
                .endCell(),
        });
    }

    async sendCloseRequest(provider: ContractProvider, via: Sender, opts: {
        value: bigint;
        queryId?: number;
        sendExcessesTo: Address;
        keyPair: KeyPair;
        expectedAddress?: Address; // For testing wrong address errors
    }) {
        const signedDataCell = beginCell()
            .storeUint(OP_CLOSE_REQUEST, 32)
            .storeUint(opts.queryId ?? 0, 64)
            .storeAddress(opts.expectedAddress ?? this.address)
            .endCell();

        const signature = sign(signedDataCell.hash(), opts.keyPair.secretKey);

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP_CLOSE_REQUEST, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeAddress(opts.sendExcessesTo)
                .storeBuffer(signature)
                .storeRef(signedDataCell)
                .endCell(),
        });
    }

    async sendCloseComplete(provider: ContractProvider, via: Sender, opts: {
        value: bigint;
        queryId?: number;
        sendExcessesTo: Address;
        keyPair: KeyPair;
    }) {
        const signedDataCell = beginCell()
            .storeUint(OP_CLOSE_COMPLETE, 32)
            .storeUint(opts.queryId ?? 0, 64)
            .storeAddress(this.address)
            .endCell();

        const signature = sign(signedDataCell.hash(), opts.keyPair.secretKey);

        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP_CLOSE_COMPLETE, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeAddress(opts.sendExcessesTo)
                .storeBuffer(signature)
                .storeRef(signedDataCell)
                .endCell(),
        });
    }
}
