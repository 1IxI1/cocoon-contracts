import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = process.env.USE_TOLK === 'true' 
    ? {
        lang: 'tolk',
        entrypoint: 'contracts_tolk/cocoon_proxy.tolk',
    }
    : {
        lang: 'func',
        targets: ['contracts/cocoon_proxy.fc'],
    };
