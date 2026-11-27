import { createHash } from 'node:crypto';
import * as k8s from '@kubernetes/client-node';

const namespace = 'default';
const group = 'exercises.example.com', version = 'v1alpha1', plural = 'dummysites';
const kc = new k8s.KubeConfig();
kc.loadFromCluster();
const apps = kc.makeApiClient(k8s.AppsV1Api);
const core = kc.makeApiClient(k8s.CoreV1Api);
const custom = kc.makeApiClient(k8s.CustomObjectsApi);
const informer = k8s.makeInformer(kc, `/apis/${group}/${version}/namespaces/${namespace}/${plural}`,
  () => custom.listNamespacedCustomObject({ group, version, namespace, plural }));

async function existing(read, uid) {
  try {
    const obj = await read();
    if (!obj.metadata.ownerReferences?.some(ref => ref.controller && ref.uid === uid))
      throw new Error('Child name is already in use by another owner');
    return obj;
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

async function reconcile(site) {
  const { uid, name: parent } = site.metadata;
  const short = parent.replaceAll('.', '-').slice(0, 45);
  const name = `ds-${short}-${createHash('sha256').update(parent).digest('hex').slice(0, 8)}`;
  const labels = { 'dummysite-instance': name };
  const metadata = { name, namespace, labels, ownerReferences: [
    { apiVersion: `${group}/${version}`, kind: 'DummySite', name: parent, uid, controller: true },
  ] };
  const params = { name, namespace };
  const deployment = await existing(() => apps.readNamespacedDeployment(params), uid);
  const init = { name: 'mirror', image: process.env.MIRROR_IMAGE, command: ['node', 'src/mirror.js'],
    env: [{ name: 'WEBSITE_URL', value: site.spec.website_url }],
    resources: { requests: { cpu: '10m', memory: '32Mi' }, limits: { memory: '160Mi' } },
    volumeMounts: [{ name: 'site', mountPath: '/site' }] };
  if (!deployment) {
    await apps.createNamespacedDeployment({ namespace, body: { metadata, spec: {
      replicas: 1, selector: { matchLabels: labels }, template: { metadata: { labels }, spec: {
        automountServiceAccountToken: false, securityContext: { fsGroup: 1000 }, initContainers: [init],
        containers: [{ name: 'nginx', image: 'nginx:stable-alpine', ports: [{ containerPort: 80 }],
          readinessProbe: { httpGet: { path: '/', port: 80 } },
          resources: { requests: { cpu: '5m', memory: '8Mi' }, limits: { memory: '64Mi' } },
          volumeMounts: [{ name: 'site', mountPath: '/usr/share/nginx/html', readOnly: true }] }],
        volumes: [{ name: 'site', emptyDir: { sizeLimit: '32Mi' } }],
      } },
    } } });
  } else {
    const previous = deployment.spec.template.spec.initContainers[0];
    if (previous.env[0].value !== site.spec.website_url || previous.image !== init.image) {
      deployment.spec.template.spec.initContainers = [init];
      await apps.replaceNamespacedDeployment({ ...params, body: deployment });
    }
  }
  if (!await existing(() => core.readNamespacedService(params), uid)) {
    await core.createNamespacedService({ namespace, body: { metadata, spec: {
      selector: labels, ports: [{ name: 'http', port: 80, targetPort: 80 }],
    } } });
  }
  console.log(`Reconciled ${parent}: svc/${name}`);
}

// Serialize updates per object. Read the latest cached version when each turn starts.
const pending = new Map();
function enqueue(site) {
  const key = site.metadata.name;
  const task = (pending.get(key) ?? Promise.resolve()).then(async () => {
    const latest = informer.get(key, namespace);
    if (latest && !latest.metadata.deletionTimestamp) await reconcile(latest);
  }).catch(err => {
    console.error(`Reconcile ${key}:`, err.message);
    setTimeout(() => { if (!pending.has(key) && informer.get(key, namespace)) enqueue(site); }, 5000);
  }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
  pending.set(key, task);
}
informer.on('add', enqueue);
informer.on('update', enqueue);
informer.on('error', err => {
  console.error('Watch disconnected:', err.message);
  setTimeout(() => informer.start(), 5000);
});
await informer.start();
