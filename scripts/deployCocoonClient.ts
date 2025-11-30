import { toNano } from '@ton/core';
import { CocoonClient } from '../wrappers/CocoonClient';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const cocoonClient = provider.open(CocoonClient.createFromConfig({}, await compile('CocoonClient')));

    await cocoonClient.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(cocoonClient.address);

    // run methods on `cocoonClient`
}
