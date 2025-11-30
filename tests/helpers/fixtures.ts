import { KeyPair, keyPairFromSeed } from '@ton/crypto';
import { Address, Cell, Dictionary, toNano } from '@ton/core';
import { Blockchain, SandboxContract, SendMessageResult, TreasuryContract } from '@ton/sandbox';
import { CocoonParams, cocoonParamsToCell } from '../../wrappers/CocoonRoot';
import { CocoonProxy } from '../../wrappers/CocoonProxy';

/**
 * Test keypairs for signing tests
 * Using deterministic seeds for reproducibility
 */
export class TestKeyPairs {
    static readonly PROXY_KEYPAIR: KeyPair = keyPairFromSeed(
        Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex')
    );

    static readonly PROXY_KEYPAIR_2: KeyPair = keyPairFromSeed(
        Buffer.from('0000000000000000000000000000000000000000000000000000000000000002', 'hex')
    );

    static readonly WALLET_KEYPAIR: KeyPair = keyPairFromSeed(
        Buffer.from('0000000000000000000000000000000000000000000000000000000000000003', 'hex')
    );

    static readonly WRONG_KEYPAIR: KeyPair = keyPairFromSeed(
        Buffer.from('9999999999999999999999999999999999999999999999999999999999999999', 'hex')
    );
}

/**
 * Default Cocoon parameters for testing
 */
export function createDefaultParams(overrides?: Partial<CocoonParams>): CocoonParams {
    return {
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
        proxy_delay_before_close: 3600,
        client_delay_before_close: 3600,
        min_proxy_stake: toNano('1.0'),
        min_client_stake: toNano('1.0'),
        proxy_sc_code: null,
        worker_sc_code: null,
        client_sc_code: null,
        ...overrides,
    };
}

/**
 * Create params cell from parameters
 */
export function createParamsCell(overrides?: Partial<CocoonParams>): Cell {
    return cocoonParamsToCell(createDefaultParams(overrides));
}

/**
 * Common test constants
 */
export const TestConstants = {
    // Values
    SMALL_VALUE: toNano('0.01'),
    MEDIUM_VALUE: toNano('0.1'),
    LARGE_VALUE: toNano('1.0'),
    VERY_LARGE_VALUE: toNano('10.0'),

    // Delays
    SHORT_DELAY: 60, // 1 minute
    MEDIUM_DELAY: 3600, // 1 hour
    LONG_DELAY: 86400, // 1 day

    // Common IDs
    DEFAULT_QUERY_ID: 123n,
    DEFAULT_SECRET_HASH: 0n,

    // Error codes
    ERROR_OLD_MESSAGE: 1000,
    ERROR_LOW_SMC_BALANCE: 1001,
    ERROR_LOW_BALANCE: 1002,
    ERROR_LOW_MSG_VALUE: 1003,
    ERROR_MSG_FORMAT_MISMATCH: 1004,
    ERROR_SIGNED_MSG_FORMAT_MISMATCH: 1005,
    ERROR_CLOSED: 1006,
    ERROR_BAD_SIGNATURE: 1007,
    ERROR_STORED_DATA_DAMAGED: 1008,
    ERROR_EXPECTED_OWNER: 1009,
    ERROR_EXPECTED_MESSAGE_FROM_OWNER: 1010,
    ERROR_NOT_UNLOCKED_YET: 1011,
    ERROR_UNKNOWN_OP: 1012,
    ERROR_UNKNOWN_TEXT_OP: 1013,
    ERROR_CONTRACT_ADDRESS_MISMATCH: 1014,
    ERROR_EXPECTED_MY_ADDRESS: 1015,
    ERROR_UNKNOWN_PROXY_TYPE: 2000,

    // Wallet error codes
    WALLET_ERROR_EXPIRED: 1030,
    WALLET_ERROR_BLOCKED: 1031,
    WALLET_ERROR_WRONG_SEQNO: 1032,
    WALLET_ERROR_WRONG_SUBWALLET: 1033,
    WALLET_ERROR_BAD_SIGNATURE: 1034,
    WALLET_ERROR_LOW_BALANCE: 1035,
    WALLET_ERROR_NOT_OWNER: 1040,
    WALLET_ERROR_UNKNOWN_TEXT_CMD: 1041,

    // Opcodes
    OP_EXCESSES: 0x2565934c,
    OP_PAYOUT: 0xc59a7cd3,
    OP_DO_NOT_PROCESS: 0x9a1247c0,
    OP_WORKER_PROXY_REQUEST: 0x4d725d2c,
    OP_CLIENT_PROXY_REQUEST: 0x65448ff4,

    // States
    STATE_NORMAL: 0,
    STATE_CLOSING: 1,
    STATE_CLOSED: 2,
};

/**
 * Helper to create hash buffers for testing
 */
export function createTestHash(value: number): Buffer {
    return Buffer.alloc(32, value);
}

/**
 * Helper to create empty dictionary
 */
export function createEmptyDict(): Dictionary<any, any> {
    return Dictionary.empty();
}

/**
 * Common proxy info string for testing
 */
export function createProxyInfo(domain: string = 'test.example.com'): string {
    return domain;
}

/**
 * Disable console.error during async callback (useful for testing expected errors)
 */
export async function disableConsoleError(callback: () => Promise<void>): Promise<void> {
    const errorsHandler = console.error;
    console.error = () => {};
    await callback();
    console.error = errorsHandler;
}

/**
 * Helper to fully close a proxy: NORMAL → CLOSING → CLOSED
 */
export async function closeProxyFully(
    cocoonProxy: SandboxContract<CocoonProxy>,
    owner: SandboxContract<TreasuryContract>,
    blockchain: Blockchain,
    keyPair: KeyPair
) {
    // Step 1: NORMAL → CLOSING
    await cocoonProxy.sendTextClose(owner.getSender(), toNano('0.1'));
    
    // Step 2: Advance time past unlock
    blockchain.now = Math.floor(Date.now() / 1000) + 7300;
    
    // Step 3: CLOSING → CLOSED via signed CloseComplete
    await cocoonProxy.sendCloseComplete(owner.getSender(), {
        value: toNano('0.2'),
        sendExcessesTo: owner.address,
        keyPair,
    });
    expect(await cocoonProxy.getData()).toMatchObject({
        state: TestConstants.STATE_CLOSED,
    });
}

// === Outbound Message Helpers ===

/**
 * Assert excesses message was sent to recipient
 */
export function assertExcessesSent(result: SendMessageResult, recipient: Address, from?: Address) {
    const match: any = { to: recipient, op: TestConstants.OP_EXCESSES, success: true };
    if (from) match.from = from;
    expect(result.transactions).toHaveTransaction(match);
}

// === External Message Helpers ===

/**
 * Assert that external message fails validation
 */
export async function assertExternalMessageFails(
    blockchain: Blockchain,
    dest: Address,
    body: Cell,
    _expectedExitCode?: number // Ignored - kept for compatibility
): Promise<void> {
    const errorsHandler = console.error;
    console.error = () => {};
    try {
        await expect(
            blockchain.sendMessage({
                info: { type: 'external-in', dest, importFee: 0n },
                body,
            })
        ).rejects.toThrow();
    } finally {
        console.error = errorsHandler;
    }
}


