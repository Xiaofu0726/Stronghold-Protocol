// Fork convenience policy: first-period rooms may equip operators on the bench.
// Full-bench swaps already use the upstream 0.3.3 implementation.
// Keep the historical build profiles and every other version rule untouched.
/** @param {any} config */
export function withFirstPeriodPrepInteractions(config) {
  const version = config?.version;
  if (version?.id !== 'act1autochess' && version?.id !== 'act1autochess@V1_1') return config;
  return {
    ...config,
    version: {
      ...version,
      rules: { ...version.rules, benchEquip: true },
    },
  };
}
