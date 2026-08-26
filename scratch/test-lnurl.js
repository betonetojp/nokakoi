import { bech32 } from '@scure/base';

const url = 'https://domain.com/lnurl-pay';
const bytes = new TextEncoder().encode(url);

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  const max_acc = (1 << (fromBits + toBits - 1)) - 1;
  for (let i = 0; i < data.length; ++i) {
    const value = data[i];
    acc = ((acc << fromBits) | value) & max_acc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    ret.push((acc << (toBits - bits)) & maxv);
  }
  return ret;
}

const words = convertBits(bytes, 8, 5, true);
const encoded = bech32.encode('lnurl', words, 1023);
console.log('Encoded:', encoded);
