import path from 'node:path';

const required = (options, name) => {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

const requiredPattern = (options) => {
  if (!(options.idPattern instanceof RegExp)) throw new Error('idPattern must be a RegExp');
  return options.idPattern;
};

const requiredUnitId = (options) => {
  const unitId = required(options, 'unitId');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u.test(unitId)) throw new Error('unitId contains unsupported characters');
  return unitId;
};

export const testManagerVitestReporter = (options) => {
  const toolDirectory = path.resolve(required(options, 'toolDirectory'));
  const stateDirectory = path.resolve(required(options, 'stateDirectory'));
  const unitId = requiredUnitId(options);
  return [path.join(toolDirectory, 'dist/vitest-adapter.js'), {
    outputFile: path.join(stateDirectory, 'unit-artifacts', `${unitId}.test-manager-unit.json`),
    artifactRoot: path.join(stateDirectory, 'runner-artifacts'),
    unitId,
    layer: required(options, 'layer'),
    target: required(options, 'target'),
    idPattern: requiredPattern(options),
  }];
};

export const testManagerPlaywrightReporter = (options) => {
  const toolDirectory = path.resolve(required(options, 'toolDirectory'));
  const stateDirectory = path.resolve(required(options, 'stateDirectory'));
  return [path.join(toolDirectory, 'dist/playwright-adapter.js'), {
    outputDirectory: path.join(stateDirectory, 'unit-artifacts'),
    artifactRoot: path.join(stateDirectory, 'runner-artifacts'),
    unitId: requiredUnitId(options),
    idPattern: requiredPattern(options),
  }];
};
