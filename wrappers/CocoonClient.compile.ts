import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = process.env.USE_TOLK === 'true' 
    ? {
        lang: 'tolk',
        entrypoint: 'contracts_tolk/cocoon_client.tolk',
    }
    : {
        lang: 'func',
        targets: ['contracts/cocoon_client.fc'],
    };
