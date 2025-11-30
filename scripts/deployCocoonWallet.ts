import { toNano } from '@ton/core';
import { CocoonWallet, CocoonWalletConfig } from '../wrappers/CocoonWallet';
import { compile, NetworkProvider } from '@ton/blueprint';
import {promptUrl, promptAddress, promptToncoin, promptUserFriendlyAddress, assert} from "../wrappers/ui-utils";

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();
    
    const adminAddress = await promptUserFriendlyAddress("Enter the address of owner:", ui, isTestnet);
    
    const hashToBeAddedHex = await ui.input("public key (in HEX format):");
   
    const hashToBeAdded = await Buffer.from(hashToBeAddedHex, 'hex') 
    assert (hashToBeAdded.length == 32, "hash has to be 32 bytes long", ui);
    
    const conf : CocoonWalletConfig = {
      publicKey: hashToBeAdded,
      ownerAddress: adminAddress.address
    };

    const cocoonWallet = provider.open(CocoonWallet.createFromConfig(conf, await compile('CocoonWallet')));

    await cocoonWallet.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(cocoonWallet.address);

    // run methods on `cocoonWallet`
}
