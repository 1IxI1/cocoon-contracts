import { toNano, Address, beginCell, Cell, Builder, Contract, contractAddress, ContractProvider, Sender, SendMode, Slice, Dictionary, BitString } from '@ton/core';
import { CocoonRoot, CocoonRootConfig } from '../wrappers/CocoonRoot';
import { CocoonWorker } from '../wrappers/CocoonWorker';
import { CocoonClient } from '../wrappers/CocoonClient';
import { CocoonProxy } from '../wrappers/CocoonProxy';
import { CocoonWallet, CocoonWalletConfig } from '../wrappers/CocoonWallet';
import { compile, NetworkProvider, UIProvider } from '@ton/blueprint';
import {promptUrl, promptAddress, promptToncoin, promptUserFriendlyAddress, assert} from "../wrappers/ui-utils";

const clientWithdraw = async(provider:NetworkProvider, ui:UIProvider) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const clientWalletAddress : Address = await promptAddress("Enter the address of the client wallet contract:", ui);
    const clientProxyScAddress : Address = await promptAddress("Enter the address of the client proxy smartcontract:", ui);
      
    const msg = beginCell()
          .storeUint(0xda068e78, 32)
          .storeInt(0, 64)
          .storeAddress(clientWalletAddress)
          .endCell();

    const cocoonWallet = provider.open(CocoonWallet.createFromAddress(clientWalletAddress));
    await cocoonWallet.sendForwardMessage(provider.sender(), clientProxyScAddress, msg, toNano('1.0'));
};

const clientRequestRefund = async(provider:NetworkProvider, ui:UIProvider) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const clientWalletAddress : Address = await promptAddress("Enter the address of the client wallet contract:", ui);
    const clientProxyScAddress : Address = await promptAddress("Enter the address of the client proxy smartcontract:", ui);
      
    const msg = beginCell()
          .storeUint(0xfafa6cc1, 32)
          .storeInt(0, 64)
          .storeAddress(clientWalletAddress)
          .endCell();

    const cocoonWallet = provider.open(CocoonWallet.createFromAddress(clientWalletAddress));
    await cocoonWallet.sendForwardMessage(provider.sender(), clientProxyScAddress, msg, toNano('1.0'));
};


const actionList = [ 'clientWithdraw', 
                     'clientRequestRefund',
                     'Quit' ];

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const workerCode = await compile('CocoonWorker');
    const clientCode = await compile('CocoonClient');
    const proxyCode = await compile('CocoonProxy');
   

    let done = false;
    do {
        ui.clearActionPrompt();
        const action = await ui.choose("Pick action:", actionList, (c: string) => c);
        switch(action) {
            case 'clientWithdraw':
                await clientWithdraw(provider, ui);
                break;
            case 'clientRequestRefund':
                await clientRequestRefund(provider, ui);
                break;
            case 'Quit':
                done = true;
                break;
            default:
                ui.write('Operation is not yet supported!');
        }
    } while(!done);
}
