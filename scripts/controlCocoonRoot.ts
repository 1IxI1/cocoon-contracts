import { toNano, fromNano, Address, Dictionary, BitString } from '@ton/core';
import { CocoonRoot, CocoonRootConfig, createProxyInfoValue } from '../wrappers/CocoonRoot';
import { CocoonWorker } from '../wrappers/CocoonWorker';
import { CocoonClient } from '../wrappers/CocoonClient';
import { CocoonProxy } from '../wrappers/CocoonProxy';
import { compile, NetworkProvider, UIProvider } from '@ton/blueprint';
import {promptUrl, promptAddress, promptToncoin, promptUserFriendlyAddress, promptBool, assert} from "../wrappers/ui-utils";

async function unBase64OrHexHash(s:String, ui:UIProvider) {
    const base64Decoded = await Buffer.from(s, 'base64');
    if (base64Decoded.length != 32) {
        const hexDecoded = await Buffer.from(s, 'hex') ;
        assert (hexDecoded.length == 32, "hash has to be 32 bytes long", ui);
        return hexDecoded;
    }

    return base64Decoded;
}

const addProxyType = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const hashToBeAddedB64 = await ui.input("proxy HASH:");
    const hashToBeAdded = await unBase64OrHexHash(hashToBeAddedB64, ui);

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendAddProxyType(provider.sender(), hashToBeAdded);
};

const delProxyType = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const hashToBeRemovedB64 = await ui.input("proxy HASH:");
    const hashToBeRemoved = await unBase64OrHexHash(hashToBeRemovedB64, ui);

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendDelProxyType(provider.sender(), hashToBeRemoved);
};

const addWorkerType = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const crypto = require('crypto');

    const isTestnet = provider.network() !== 'mainnet';
    
    const hashToBeAddedB64 = await ui.input("worker HASH:");
    const hashToBeAdded = await unBase64OrHexHash(hashToBeAddedB64, ui);

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendAddWorkerType(provider.sender(), hashToBeAdded);
};

const delWorkerType = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const hashToBeRemovedB64 = await ui.input("worker HASH:");
    const hashToBeRemoved = await unBase64OrHexHash(hashToBeRemovedB64, ui);

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendDelWorkerType(provider.sender(), hashToBeRemoved);
};

const addModelType = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const crypto = require('crypto');

    const isTestnet = provider.network() !== 'mainnet';
    
    const modelType = await ui.input("model TYPE (string):");
    const modelTypeHash = await crypto.createHash('sha256').update(modelType).digest('Buffer');

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendAddModelType(provider.sender(), modelTypeHash);
};

const delModelType = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const crypto = require('crypto');

    const isTestnet = provider.network() !== 'mainnet';
    
    const modelType = await ui.input("model TYPE (string):");
    const modelTypeHash = await crypto.createHash('sha256').update(modelType).digest('Buffer');

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendDelModelType(provider.sender(), modelTypeHash);
};

const addProxyInfo = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const proxyAddress = await ui.input("proxy IP and PORT:");
    assert (proxyAddress.length <= 127, "address must not be longer than 127 bytes", ui);

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendAddProxyInfo(provider.sender(), proxyAddress);
};

const delProxyInfo = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const proxySeqno = parseInt(await ui.input("proxy seqno:"), 10);
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendDelProxyInfo(provider.sender(), proxySeqno);
};

const updateProxyInfo = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const proxySeqno = parseInt(await ui.input("proxy seqno:"), 10);
    
    const proxyAddress = await ui.input("proxy new IP and PORT:");
    assert (proxyAddress.length <= 127, "address must not be longer than 127 bytes", ui);
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendUpdateProxyInfo(provider.sender(), proxySeqno, proxyAddress);
};

const updateRootCode = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const rootCode = await compile('CocoonRoot');
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendUpdateCode(provider.sender(), rootCode);
};

const changeFees = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const pricePerToken  = BigInt(await ui.input("price per token:"));
    const workerFeePerToken  = BigInt(await ui.input("worker fee per token:"));
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendChangeFees(provider.sender(), pricePerToken, workerFeePerToken);
};

const changeParams = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const pricePerToken  = BigInt(await ui.input("price per token:"));
    const workerFeePerToken  = BigInt(await ui.input("worker fee per token:"));
    const proxyDelayBeforeClose = parseInt(await ui.input("proxy delay before close (in seconds):"));
    const clientDelayBeforeClose = parseInt(await ui.input("client delay before close (in seconds):"));
    const minProxyStake = toNano(await ui.input("proxy minimal stake (in tons):"));
    const minClientStake = toNano(await ui.input("client minimal stake (in tons):"));

    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendChangeParams(provider.sender(), pricePerToken, workerFeePerToken, proxyDelayBeforeClose, clientDelayBeforeClose, minProxyStake, minClientStake);
};

const changeOwner = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const newOwner  = await promptAddress("Enter the new address of the cocoon root contract owner:", ui);
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendChangeOwner(provider.sender(), newOwner);
};

const reset = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendReset(provider.sender());
};

const updateContracts = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const workerCode = await compile('CocoonWorker');
    const clientCode = await compile('CocoonClient');
    const proxyCode = await compile('CocoonProxy');
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    await cocoonRoot.sendUpdateContracts(provider.sender(), proxyCode, workerCode, clientCode);
};

const getLastProxySeqno = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    
    const seqno = await cocoonRoot.getLastProxySeqno();
    
    console.log("seqno=" + seqno);
};

const getAllParams = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    
    const conf = await cocoonRoot.getAllParams();
    if (!conf) {
      console.log("not deployted");
      return;
    } 
 
    console.log("owner_address=" + conf.owner_address);
    console.log("proxies_hashes=[");
    for (const [k, v] of conf.proxy_hashes) {
      console.log("    " + k.toString(16)); 
    }
    console.log("]");
    console.log("registered_proxies=[");
    for (const [k, v] of conf.registered_proxies) {
      console.log("    #" + k + " " + v.addr); 
    }
    console.log("]");
    console.log("last_proxy_seqno=" + conf.last_proxy_seqno);
    console.log("worker_types=[");
    for (const [k, v] of conf.worker_hashes) {
      console.log("    " + k.toString(16)); 
    }
    console.log("]");
    console.log("model_types=[");
    for (const [k, v] of conf.model_hashes) {
      console.log("    " + k.toString(16)); 
    }
    console.log("]");
    console.log("version=" + conf.version);
    console.log("params_struct_version=" + conf.params.struct_version);
    console.log("params_version=" + conf.params.params_version);
    console.log("unique_id=" + conf.params.unique_id);
    console.log("is_test=" + conf.params.is_test);
    console.log("price_per_token=" + conf.params.price_per_token);
    console.log("worker_fee_per_token=" + conf.params.worker_fee_per_token);
    console.log("prompt_tokens_price_multiplier=" + (conf.params.prompt_tokens_price_multiplier * 0.0001));
    console.log("cached_tokens_price_multiplier=" + (conf.params.cached_tokens_price_multiplier * 0.0001));
    console.log("completion_tokens_price_multiplier=" + (conf.params.completion_tokens_price_multiplier * 0.0001));
    console.log("reasoning_tokens_price_multiplier=" + (conf.params.reasoning_tokens_price_multiplier * 0.0001));
    console.log("proxy_delay_before_close=" + conf.params.proxy_delay_before_close);
    console.log("client_delay_before_close=" + conf.params.client_delay_before_close);
    console.log("min_proxy_stake=" + conf.params.min_proxy_stake);
    console.log("min_client_stake=" + conf.params.min_client_stake);
    if (conf.params.proxy_sc_code) {
      console.log("proxy_sc_code=" + conf.params.proxy_sc_code.hash().toString('hex'));
    }
    if (conf.params.worker_sc_code) {
      console.log("worker_sc_code=" + conf.params.worker_sc_code.hash().toString('hex'));
    }
    if (conf.params.client_sc_code) {
      console.log("client_sc_code=" + conf.params.client_sc_code.hash().toString('hex'));
    }
};

const updateAllParams = async(provider:NetworkProvider, ui:UIProvider, rootAddress:Address) => {
    const isTestnet = provider.network() !== 'mainnet';
    
    const cocoonRoot = provider.open(CocoonRoot.createFromAddress(rootAddress));
    
    let conf = await cocoonRoot.getAllParams();
    if (!conf) {
      console.log("not deployed, cannot update parameters");
      return;
    }

    assert (conf.params.struct_version >= 0 && conf.params.struct_version <= 3, "unknown struct version " + conf.params.struct_version, ui);

    conf.params.struct_version = 3;
    conf.params.params_version += 1;
    conf.version += 1;
   
    let val : string = "";
    val = await ui.input("new pricePerToken, empty to leave current value " + conf.params.price_per_token + ": ");
    if (val != "" && val != " ") {
      conf.params.price_per_token = BigInt(parseInt(val));
    }
    val = await ui.input("new workerFeePerToken, empty to leave current value " + conf.params.worker_fee_per_token + ": ");
    if (val != "" && val != " ") {
      conf.params.worker_fee_per_token = BigInt(parseInt(val));
    }
    val = await ui.input("new promptTokensPriceMultiplier, empty to leave current value " + (conf.params.prompt_tokens_price_multiplier * 0.0001) + ": ");
    if (val != "" && val != " ") {
      conf.params.prompt_tokens_price_multiplier = Math.round(parseFloat(val) * 10000);
    }
    val = await ui.input("new cachedTokensPriceMultiplier, empty to leave current value " + (conf.params.cached_tokens_price_multiplier * 0.0001) + ": ");
    if (val != "" && val != " ") {
      conf.params.cached_tokens_price_multiplier = Math.round(parseFloat(val) * 10000);
    }
    val = await ui.input("new completionTokensPriceMultiplier, empty to leave current value " + (conf.params.completion_tokens_price_multiplier * 0.0001) + ": ");
    if (val != "" && val != " ") {
      conf.params.completion_tokens_price_multiplier = Math.round(parseFloat(val) * 10000);
    }
    val = await ui.input("new reasoningTokensPriceMultiplier, empty to leave current value " + (conf.params.reasoning_tokens_price_multiplier * 0.0001) + ": ");
    if (val != "" && val != " ") {
      conf.params.reasoning_tokens_price_multiplier = Math.round(parseFloat(val) * 10000);
    }
    val = await ui.input("new proxyDelayBeforeClose, empty to leave current value " + conf.params.proxy_delay_before_close + ": ");
    if (val != "" && val != " ") {
      conf.params.proxy_delay_before_close = parseInt(val);
    }
    val = await ui.input("new clientDelayBeforeClose, empty to leave current value " + conf.params.client_delay_before_close + ": ");
    if (val != "" && val != " ") {
      conf.params.client_delay_before_close = parseInt(val);
    }
    val = await ui.input("new minProxyStake, empty to leave current value " + fromNano(conf.params.min_proxy_stake) + ": ");
    if (val != "" && val != " ") {
      conf.params.min_proxy_stake = toNano(parseFloat(val));
    }
    val = await ui.input("new minClientStake, empty to leave current value " + fromNano(conf.params.min_client_stake) + ": ");
    if (val != "" && val != " ") {
      conf.params.min_client_stake = toNano(parseInt(val));
    }
    
    let updProxyHashes = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.BitString(0));
    for (const [k, v] of conf.proxy_hashes) {
      const b = await promptBool("leave proxy hash " + k.toString(16) + "?", ["y", "n"], ui);
      if (b) {
        updProxyHashes.set(k, v);
      }
    }
    conf.proxy_hashes = updProxyHashes;
    
    let updRegisteredProxies = Dictionary.empty(Dictionary.Keys.Uint(32), createProxyInfoValue());
    for (const [k, v] of conf.registered_proxies) {
      const b = await promptBool("leave proxy #" + k + " at " + v.addr + "?", ["y", "n"], ui);
      if (b) {
        updRegisteredProxies.set(k, v);
      }
    }
    conf.registered_proxies = updRegisteredProxies;
    
    let updWorkerHashes = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.BitString(0));
    for (const [k, v] of conf.worker_hashes) {
      const b = await promptBool("leave worker hash " + k.toString(16) + "?", ["y", "n"], ui);
      if (b) {
        updWorkerHashes.set(k, v);
      }
    }
    conf.worker_hashes = updWorkerHashes;
    
    let updModelHashes = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.BitString(0));
    for (const [k, v] of conf.model_hashes) {
      const b = await promptBool("leave model hash " + k.toString(16) + "?", ["y", "n"], ui);
      if (b) {
        updModelHashes.set(k, v);
      }
    }
    conf.model_hashes = updModelHashes;

    
    const workerCode = await compile('CocoonWorker');
    const clientCode = await compile('CocoonClient');
    const proxyCode = await compile('CocoonProxy');
    const rootCode = await compile('CocoonRoot');
    conf.params.proxy_sc_code = proxyCode;
    conf.params.worker_sc_code = workerCode;
    conf.params.client_sc_code = clientCode;
    
    await cocoonRoot.sendUpgradeFull(provider.sender(), conf, rootCode);
};

const actionList = [ 'addProxyType', 
                     'delProxyType', 
                     'addWorkerType', 
                     'delWorkerType', 
                     'addModelType', 
                     'delModelType',
                     'addProxyInfo', 
                     'delProxyInfo', 
                     'updateProxyInfo', 
                     'updateRootCode', 
                     'updateContracts', 
                     'changeFees', 
                     'changeParams', 
                     'changeOwner', 
                     'reset', 
                     'getLastProxySeqno', 
                     'getAllParams', 
                     'updateAllParams', 
                     'Quit' ];

async function getRootAddress(ui:UIProvider) {
  if (process.argv.length >= 5) {
    try {
        return Address.parse(process.argv[4]);
    } catch (e) {
        console.log("invalid address '" + process.argv[4] + "'");
        return await promptAddress("Enter the address of the cocoon root contract:", ui);
    }
  } else {
    return await promptAddress("Enter the address of the cocoon root contract:", ui);
  }
}

export async function run(provider: NetworkProvider) {
    const isTestnet = provider.network() !== 'mainnet';
    const ui = provider.ui();

    const workerCode = await compile('CocoonWorker');
    const clientCode = await compile('CocoonClient');
    const proxyCode = await compile('CocoonProxy');
   
    let done = false;
    const rootAddress : Address = await getRootAddress(ui);

    do {
        ui.clearActionPrompt();
        const action = await ui.choose("Pick action:", actionList, (c: string) => c);
        switch(action) {
            case 'addProxyType':
                await addProxyType(provider, ui, rootAddress);
                break;
            case 'delProxyType':
                await delProxyType(provider, ui, rootAddress);
                break;
            case 'addWorkerType':
                await addWorkerType(provider, ui, rootAddress);
                break;
            case 'delWorkerType':
                await delWorkerType(provider, ui, rootAddress);
                break;
            case 'addModelType':
                await addModelType(provider, ui, rootAddress);
                break;
            case 'delModelType':
                await delModelType(provider, ui, rootAddress);
                break;
            case 'addProxyInfo':
                await addProxyInfo(provider, ui, rootAddress);
                break;
            case 'delProxyInfo':
                await delProxyInfo(provider, ui, rootAddress);
                break;
            case 'updateProxyInfo':
                await updateProxyInfo(provider, ui, rootAddress);
                break;
            case 'updateRootCode':
                await updateRootCode(provider, ui, rootAddress);
                break;
            case 'updateContracts':
                await updateContracts(provider, ui, rootAddress);
                break;
            case 'changeFees':
                await changeFees(provider, ui, rootAddress);
                break;
            case 'changeParams':
                await changeParams(provider, ui, rootAddress);
                break;
            case 'changeOwner':
                await changeOwner(provider, ui, rootAddress);
                break;
            case 'getLastProxySeqno':
                await getLastProxySeqno(provider, ui, rootAddress);
                break;
            case 'getAllParams':
                await getAllParams(provider, ui, rootAddress);
                break;
            case 'updateAllParams':
                await updateAllParams(provider, ui, rootAddress);
                break;
            case 'reset':
                await reset(provider, ui, rootAddress);
                break;
            case 'Quit':
                done = true;
                break;
            default:
                ui.write('Operation is not yet supported!');
        }
    } while(!done);
}
