import { toNano } from '@ton/core';
import { CocoonWorker } from '../wrappers/CocoonWorker';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const cocoonWorker = provider.open(CocoonWorker.createFromConfig({}, await compile('CocoonWorker')));

    await cocoonWorker.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(cocoonWorker.address);

    // run methods on `cocoonWorker`
}
