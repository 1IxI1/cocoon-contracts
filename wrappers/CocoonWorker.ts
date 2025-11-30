import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode } from '@ton/core';
import { sign } from '@ton/crypto';

// Opcodes (exported for tests)
const OP_OWNER_WORKER_REGISTER = 0x26ed7f65;
export const OP_PAYOUT_SIGNED = 0xa040ad28;
export const OP_LAST_PAYOUT_SIGNED = 0xf5f26a36;
const OP_WORKER_PROXY_REQUEST = 0x4d725d2c;
const OP_WORKER_PROXY_PAYOUT_REQUEST = 0x08e7d036;

export type CocoonWorkerConfig = {
    ownerAddress: Address;
    proxyAddress: Address;
    proxyPublicKey: bigint;
    state?: number;  // default: 0 (normal)
    tokens?: bigint; // default: 0
    params: Cell;
};

export function cocoonWorkerConfigToCell(config: CocoonWorkerConfig): Cell {
    return beginCell()
        .storeAddress(config.ownerAddress)
        .storeAddress(config.proxyAddress)
        .storeUint(config.proxyPublicKey, 256)
        .storeUint(config.state ?? 0, 2)  // default: worker_state_normal
        .storeUint(config.tokens ?? 0, 64)  // default: 0
        .storeRef(config.params)
        .endCell();
}

export class CocoonWorker implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new CocoonWorker(address);
    }

    static createFromConfig(config: CocoonWorkerConfig, code: Cell, workchain = 0) {
        const data = cocoonWorkerConfigToCell(config);
        const init = { code, data };
        return new CocoonWorker(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async getData(provider: ContractProvider) {
        const res = await provider.get('get_cocoon_worker_data', []);
        return {
            ownerAddress: res.stack.readAddress(),
            proxyAddress: res.stack.readAddress(),
            proxyPublicKey: res.stack.readBigNumber(),
            state: res.stack.readNumber(),
            tokens: res.stack.readBigNumber(),
        };
    }

    // Send register request (from owner)
    async sendRegister(provider: ContractProvider, via: Sender, sendExcessesTo: Address, value: bigint) {
        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(OP_OWNER_WORKER_REGISTER, 32)
                .storeUint(0, 64) // queryId
                .storeAddress(sendExcessesTo)
                .endCell(),
        });
    }

    // Send signed payout request
    async sendSignedPayout(
        provider: ContractProvider,
        via: Sender,
        op: number,
        queryId: number,
        newTokens: bigint,
        workerAddress: Address,
        sendExcessesTo: Address,
        signature: Buffer,
        value: bigint
    ) {
        // Create the signed data cell
        const signedDataCell = beginCell()
            .storeUint(op, 32)
            .storeUint(queryId, 64)
            .storeUint(newTokens, 64)
            .storeAddress(workerAddress)
            .endCell();
        
        // Create outer message
        const body = beginCell()
            .storeUint(op, 32)
            .storeUint(queryId, 64)
            .storeAddress(sendExcessesTo)
            .storeBuffer(signature)
            .storeRef(signedDataCell)
            .endCell();
        
        return await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
        });
    }

    async sendPayoutRequest(
        provider: ContractProvider,
        via: Sender,
        queryId: number,
        newTokens: bigint,
        workerAddress: Address,
        sendExcessesTo: Address,
        keyPair: any, // KeyPair from @ton/crypto
        value: bigint
    ) {
        const signedDataCell = beginCell()
            .storeUint(OP_PAYOUT_SIGNED, 32)
            .storeUint(queryId, 64)
            .storeUint(newTokens, 64)
            .storeAddress(workerAddress)
            .endCell();
        
        const signature = sign(signedDataCell.hash(), keyPair.secretKey);
        
        return this.sendSignedPayout(
            provider,
            via,
            OP_PAYOUT_SIGNED,
            queryId,
            newTokens,
            workerAddress,
            sendExcessesTo,
            signature,
            value
        );
    }

    async sendLastPayoutRequest(
        provider: ContractProvider,
        via: Sender,
        queryId: number,
        newTokens: bigint,
        workerAddress: Address,
        sendExcessesTo: Address,
        keyPair: any, // KeyPair from @ton/crypto
        value: bigint
    ) {
        const signedDataCell = beginCell()
            .storeUint(OP_LAST_PAYOUT_SIGNED, 32)
            .storeUint(queryId, 64)
            .storeUint(newTokens, 64)
            .storeAddress(workerAddress)
            .endCell();
        
        const signature = sign(signedDataCell.hash(), keyPair.secretKey);
        
        return this.sendSignedPayout(
            provider,
            via,
            OP_LAST_PAYOUT_SIGNED,
            queryId,
            newTokens,
            workerAddress,
            sendExcessesTo,
            signature,
            value
        );
    }
}
