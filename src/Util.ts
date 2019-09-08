// eslint-disable-next-line
function _mapAllStrings<T>(value: T, mapperFunc: (s: string) => any): T {
  if (typeof value === 'string') {
    return (mapperFunc(value) as unknown) as T;
  } else if (Array.isArray(value)) {
    // eslint-disable-next-line
    return ((value as any[]).map((v: any) => _mapAllStrings(v, mapperFunc)) as unknown) as T;
  } else if (typeof value === 'object') {
    // eslint-disable-next-line
    const newValue: any = {};
    for (const prop in value) {
      const val = _mapAllStrings(value[prop], mapperFunc);
      if (val !== undefined) newValue[prop] = val;
    }
    return newValue;
  } else {
    return value;
  }
}

// eslint-disable-next-line
export function resolveVariables<T>(value: T, varValue: [string, any][]): T {
  // eslint-disable-next-line
  return _mapAllStrings(value, (s: string): any => {
    for (let i = 0; i < varValue.length; ++i) {
      if (s === varValue[i][0] && typeof varValue[i][1] !== 'string') {
        return varValue[i][1];
      }
      s = s.replace(varValue[i][0], varValue[i][1]);
    }
    return s;
  });
}

// eslint-disable-next-line
export function resolveOSEnvironmentVariables<T>(value: T, strictAllowed: boolean): T {
  const getValueOfEnv = (prop: string): string | undefined => {
    const normalize = (s: string): string => (process.platform === 'win32' ? s.toLowerCase() : s);
    const normProp = normalize(prop);
    for (const prop in process.env) {
      if (normalize(prop) == normProp) {
        return process.env[prop];
      }
    }
    return undefined;
  };
  // eslint-disable-next-line
  return _mapAllStrings(value, (s: string): any => {
    let replacedS = '';
    while (true) {
      const match = s.match(/\$\{(os_env|os_env_strict):([A-z_][A-z0-9_]*)\}/);

      if (!match) return replacedS + s;

      const val = getValueOfEnv(match[2]);

      replacedS += s.substring(0, match.index!);

      if (val !== undefined) {
        replacedS += val;
      } else {
        if (match[1] === 'os_env_strict') {
          if (strictAllowed) return undefined;
          else replacedS += '<missing env>';
        } else {
          // skip: replaces to empty string
        }
      }

      s = s.substring(match.index! + match[0].length);
    }
  });
}

let uidCounter = 0;

export function generateUniqueId(): string {
  return (++uidCounter).toString();
}

import * as crypto from 'crypto';

export function hashString<T>(str: string, algorithm: string = 'sha1'): string {
  const hash = crypto.createHash(algorithm);
  hash.update(str);
  return hash.digest('hex');
}
