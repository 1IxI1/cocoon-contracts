import { toNano } from '@ton/core';
import { CocoonProxy } from '../wrappers/CocoonProxy';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const cocoonProxy = provider.open(CocoonProxy.createFromConfig({}, await compile('CocoonProxy')));

    await cocoonProxy.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(cocoonProxy.address);

    // run methods on `cocoonProxy`
}
