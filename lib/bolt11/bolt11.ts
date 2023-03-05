/* CSpell:disable*/
import { bech32 } from '../bech32/bech32';
import * as secp from '@noble/secp256k1';
type RoutingInfo = Array<{
  pubkey: string;
  short_channel_id: string;
  fee_base_msat: number;
  fee_proportional_millionths: number;
  cltv_expiry_delta: number;
}>;
type FallbackAddress = {
  code: number;
  address: string;
  addressHash: string;
};
type FeatureBits = {
  word_length: number;
  option_data_loss_protect?: Feature;
  initial_routing_sync?: Feature;
  option_upfront_shutdown_script?: Feature;
  gossip_queries?: Feature;
  var_onion_optin?: Feature;
  gossip_queries_ex?: Feature;
  option_static_remotekey?: Feature;
  payment_secret?: Feature;
  basic_mpp?: Feature;
  option_support_large_channel?: Feature;
  extra_bits?: {
    start_bit: number;
    bits: boolean[];
    has_required?: boolean;
  };
};
type Feature = {
  required?: boolean;
  supported?: boolean;
};
type Network = {
  [index: string]: any;
  bech32: string;
  pubKeyHash: number;
  scriptHash: number;
  validWitnessVersions: number[];
};
type UnknownTag = {
  tagCode: number;
  words: string;
};
type TagData =
  | string
  | number
  | RoutingInfo
  | FallbackAddress
  | FeatureBits
  | UnknownTag;
// type TagsObject = {
//   payment_hash?: string;
//   payment_secret?: string;
//   description?: string;
//   payee_node_key?: string;
//   purpose_commit_hash?: string;
//   expire_time?: number;
//   min_final_cltv_expiry?: number;
//   fallback_address?: FallbackAddress;
//   routing_info?: RoutingInfo;
//   feature_bits?: FeatureBits;
//   unknownTags?: UnknownTag[];
// };
type PaymentRequestObject = {
  paymentRequest?: string;
  complete?: boolean;
  prefix?: string;
  wordsTemp?: string;
  network?: Network;
  satoshis?: number | null;
  millisatoshis?: string | null;
  timestamp?: number;
  timestampString?: string;
  timeExpireDate?: number;
  timeExpireDateString?: string;
  payeeNodeKey?: string;
  signature?: string;
  recoveryFlag?: number;
  tags: Array<{
    tagName: string;
    data: TagData;
  }>;
};
// defaults for encode; default timestamp is current time at call
const DEFAULTNETWORK: Network = {
  // default network is bitcoin
  bech32: 'bc',
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  validWitnessVersions: [0],
};
const TESTNETWORK: Network = {
  bech32: 'tb',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  validWitnessVersions: [0],
};
const REGTESTNETWORK: Network = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  validWitnessVersions: [0],
};
const SIMNETWORK: Network = {
  bech32: 'sb',
  pubKeyHash: 0x3f,
  scriptHash: 0x7b,
  validWitnessVersions: [0],
};

const FEATUREBIT_ORDER = [
  'option_data_loss_protect',
  'initial_routing_sync',
  'option_upfront_shutdown_script',
  'gossip_queries',
  'var_onion_optin',
  'gossip_queries_ex',
  'option_static_remotekey',
  'payment_secret',
  'basic_mpp',
  'option_support_large_channel',
];

const DIVISORS: { [key: string]: bigint } = {
  m: BigInt(1e3),
  u: BigInt(1e6),
  n: BigInt(1e9),
  p: BigInt(1e12),
};

const MAX_MILLISATS = BigInt('2100000000000000000');

const MILLISATS_PER_BTC = BigInt(1e11);

const TAGCODES: { [key: string]: number } = {
  payment_hash: 1,
  payment_secret: 16,
  description: 13,
  payee: 19,
  description_hash: 23, // commit to longer descriptions (used by lnurl-pay)
  expiry: 6, // default: 3600 (1 hour)
  min_final_cltv_expiry: 24, // default: 9
  fallback_address: 9,
  route_hint: 3, // for extra routing info (private etc.)
  feature_bits: 5,
  metadata: 27,
};

// reverse the keys and values of TAGCODES and insert into TAGNAMES
const TAGNAMES: { [key: string]: string } = {};
for (let i = 0, keys = Object.keys(TAGCODES); i < keys.length; i++) {
  const currentName = keys[i];
  const currentCode = TAGCODES[keys[i]].toString();
  TAGNAMES[currentCode] = currentName;
}

const TAGPARSERS: { [key: string]: Function } = {
  '1': (words: number[]) => wordsToBuffer(words, true), // 256 bits
  '16': (words: number[]) => wordsToBuffer(words, true), // 256 bits
  '13': (words: number[]) =>
    new TextDecoder().decode(wordsToBuffer(words, true)), // string variable length
  '19': (words: number[]) => wordsToBuffer(words, true), // 264 bits
  '23': (words: number[]) => wordsToBuffer(words, true), // 256 bits
  '27': (words: number[]) => wordsToBuffer(words, true), // variable
  '6': wordsToIntBE, // default: 3600 (1 hour)
  '24': wordsToIntBE, // default: 9
  '3': routingInfoParser, // for extra routing info (private etc.)
  '5': featureBitsParser, // keep feature bits as array of 5 bit words
};

const unknownTagName = 'unknownTag';

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
// const hexToBytes = (hexString: string) => new Uint8Array(
//     hexString
//       .split(/([0-9a-f]{2})/gi)
//       .filter(hex => !!hex)
//     .map(hex=>parseInt(hex,16))
//   );

function tagsItems(tags: { tagName: string; data: any }[], tagName: string) {
  const tag = tags.filter((item) => item.tagName === tagName);
  const data = tag.length > 0 ? tag[0].data : null;
  return data;
}

function tagsContainItem(
  tags: { tagName: string; data: any }[],
  tagName: string
) {
  return tagsItems(tags, tagName) !== null;
}

function getUnknownParser(tagCode: any) {
  return (words: number[]) => ({
    tagCode: parseInt(tagCode),
    words: bech32.encode('unknown', words, Number.MAX_SAFE_INTEGER),
  });
}

function wordsToIntBE(words: number[]) {
  return words.reverse().reduce((total, item, index) => {
    return total + item * Math.pow(32, index);
  }, 0);
}

function convert(data: number[], inBits: number, outBits: number) {
  let value = 0;
  let bits = 0;
  const maxV = (1 << outBits) - 1;

  const result = [];
  for (let i = 0; i < data.length; ++i) {
    value = (value << inBits) | data[i];
    bits += inBits;

    while (bits >= outBits) {
      bits -= outBits;
      result.push((value >> bits) & maxV);
    }
  }

  if (bits > 0) {
    result.push((value << (outBits - bits)) & maxV);
  }

  return result;
}

function wordsToBuffer(words: number[], trim = false) {
  let buffer = new Uint8Array(convert(words, 5, 8));
  if (trim && (words.length * 5) % 8 !== 0) {
    buffer = buffer.slice(0, -1);
  }
  return buffer;
}

// first convert from words to buffer, trimming padding where necessary
// parse in 51 byte chunks. See encoder for details.
function routingInfoParser(words: number[]) {
  const routes = [];
  let pubkey,
    shortChannelId,
    feeBaseMSats,
    feeProportionalMillionths,
    cltvExpiryDelta;
  let routesBuffer = wordsToBuffer(words, true);
  while (routesBuffer.length > 0) {
    pubkey = bytesToHex(routesBuffer.slice(0, 33)); // 33 bytes
    shortChannelId = bytesToHex(routesBuffer.slice(33, 41)); // 8 bytes
    feeBaseMSats = parseInt(bytesToHex(routesBuffer.slice(41, 45)), 16); // 4 bytes
    feeProportionalMillionths = parseInt(
      bytesToHex(routesBuffer.slice(45, 49)),
      16
    ); // 4 bytes
    cltvExpiryDelta = parseInt(bytesToHex(routesBuffer.slice(49, 51)), 16); // 2 bytes

    routesBuffer = routesBuffer.slice(51);

    routes.push({
      pubkey,
      short_channel_id: shortChannelId,
      fee_base_msat: feeBaseMSats,
      fee_proportional_millionths: feeProportionalMillionths,
      cltv_expiry_delta: cltvExpiryDelta,
    });
  }
  return routes;
}

function featureBitsParser(words: number[]) {
  const bools = words
    .slice()
    .reverse()
    .map((word) => [
      !!(word & 0b1),
      !!(word & 0b10),
      !!(word & 0b100),
      !!(word & 0b1000),
      !!(word & 0b10000),
    ])
    .reduce((finalArr, itemArr) => finalArr.concat(itemArr), []);
  while (bools.length < FEATUREBIT_ORDER.length * 2) {
    bools.push(false);
  }
  const featureBits: { [key: string]: any } = {
    extra_bits: {},
  };

  FEATUREBIT_ORDER.forEach((featureName, index) => {
    let status;
    if (bools[index * 2]) {
      status = 'required';
    } else if (bools[index * 2 + 1]) {
      status = 'supported';
    }
    featureBits[featureName] = status;
  });

  if (bools.length > FEATUREBIT_ORDER.length * 2) {
    const extraBits = bools.slice(FEATUREBIT_ORDER.length * 2);
    featureBits.extra_bits = {
      start_bit: FEATUREBIT_ORDER.length * 2,
      bits: extraBits,
      required: extraBits.reduce(
        (result, bit, index) =>
          index % 2 !== 0 ? result || false : result || bit,
        false
      ),
    };
  }

  return featureBits;
}

function hrpToMillisat(hrpString: string) {
  let divisor = '',
    value: string;
  if (hrpString.slice(-1).match(/^[munp]$/)) {
    divisor = hrpString.slice(-1);
    value = hrpString.slice(0, -1);
  } else if (hrpString.slice(-1).match(/^[^munp0-9]$/)) {
    throw new Error('Not a valid multiplier for the amount');
  } else {
    value = hrpString;
  }

  if (!value.match(/^\d+$/))
    throw new Error('Not a valid human readable amount');

  const valueBN = BigInt(value);

  const millisatoshisBN = divisor
    ? (valueBN * MILLISATS_PER_BTC) / DIVISORS[divisor]
    : valueBN * MILLISATS_PER_BTC;

  if (
    (divisor === 'p' && !(valueBN % BigInt(10) === 0n)) ||
    millisatoshisBN > MAX_MILLISATS
  ) {
    throw new Error('Amount is outside of valid range');
  }

  return millisatoshisBN;
}

function hrpToSat(hrpString: string) {
  const millisatoshisBN = hrpToMillisat(hrpString);
  if (millisatoshisBN % 1000n !== 0n) {
    throw new Error('Amount is outside of valid range');
  }
  const result = millisatoshisBN / 1000n;
  return result;
}

// function orderKeys(
//   unorderedObj: PaymentRequestObject & { tagsObject: TagsObject },
//   forDecode: boolean
// ) {
//   const orderedObj: PaymentRequestObject = { tags: [] };
//   Object.keys(unorderedObj)
//     .sort()
//     .forEach((key) => {
//       orderedObj[key] = unorderedObj[key];
//     });
//   if (forDecode === true) {
//     const cacheName = '__tagsObject_cache';
//     Object.defineProperty(orderedObj, 'tagsObject', {
//       get() {
//         if (!this[cacheName]) {
//           Object.defineProperty(this, cacheName, {
//             value: getTagsObject(this.tags),
//           });
//         }
//         return this[cacheName];
//       },
//     });
//   }
//   return orderedObj;
// }

// function getTagsObject(tags: { [key: string]: any, tagName: string, data: TagData }[]) {
//   const unknownTags: TagData[] = [];
//   const result: {
//     [key: string]: TagData|TagData[];
//   } = {
//     unknownTags: [],
//   };
//   tags.forEach((tag) => {
//     if (tag.tagName === unknownTagName) {
//       unknownTags.push(tag.data);
//     } else {
//       result[tag.tagName] = tag.data;
//     }
//   });
//   result['unknownTags'] = unknownTags;
//   return result;
// }

// decode will only have extra comments that aren't covered in encode comments.
// also if anything is hard to read I'll comment.
async function decode(
  paymentRequest: string,
  network?: Network
): Promise<PaymentRequestObject> {
  if (typeof paymentRequest !== 'string')
    throw new Error('Lightning Payment Request must be string');
  if (paymentRequest.slice(0, 2).toLowerCase() !== 'ln')
    throw new Error('Not a proper lightning payment request');
  const decoded = bech32.decode(paymentRequest, Number.MAX_SAFE_INTEGER);
  paymentRequest = paymentRequest.toLowerCase();
  const prefix = decoded.prefix;
  let words = decoded.words;

  // signature is always 104 words on the end
  // cutting off at the beginning helps since there's no way to tell
  // ahead of time how many tags there are.
  const sigWords = words.slice(-104);
  // grabbing a copy of the words for later, words will be sliced as we parse.
  const wordsNoSig = words.slice(0, -104);
  words = words.slice(0, -104);

  let sigBuffer = wordsToBuffer(sigWords, true);
  const recoveryFlag = sigBuffer.slice(-1)[0];
  sigBuffer = sigBuffer.slice(0, -1);

  if (!(recoveryFlag in [0, 1, 2, 3]) || sigBuffer.length !== 64) {
    throw new Error('Signature is missing or incorrect');
  }

  // Without reverse lookups, can't say that the multipier at the end must
  // have a number before it, so instead we parse, and if the second group
  // doesn't have anything, there's a good chance the last letter of the
  // coin type got captured by the third group, so just re-regex without
  // the number.
  let prefixMatches = prefix.match(/^ln(\S+?)(\d*)([a-zA-Z]?)$/);
  if (prefixMatches && !prefixMatches[2])
    prefixMatches = prefix.match(/^ln(\S+)$/);
  if (!prefixMatches) {
    throw new Error('Not a proper lightning payment request');
  }

  const bech32Prefix = prefixMatches[1];
  let coinNetwork;
  if (!network) {
    switch (bech32Prefix) {
      case DEFAULTNETWORK.bech32:
        coinNetwork = DEFAULTNETWORK;
        break;
      case TESTNETWORK.bech32:
        coinNetwork = TESTNETWORK;
        break;
      case REGTESTNETWORK.bech32:
        coinNetwork = REGTESTNETWORK;
        break;
      case SIMNETWORK.bech32:
        coinNetwork = SIMNETWORK;
        break;
    }
  } else {
    if (
      network.bech32 === undefined ||
      network.pubKeyHash === undefined ||
      network.scriptHash === undefined ||
      !Array.isArray(network.validWitnessVersions)
    )
      throw new Error('Invalid network');
    coinNetwork = network;
  }
  if (!coinNetwork || coinNetwork.bech32 !== bech32Prefix) {
    throw new Error('Unknown coin bech32 prefix');
  }

  const value = prefixMatches[2];
  let satoshis, millisatoshis, removeSatoshis;
  if (value) {
    const divisor = prefixMatches[3];
    try {
      satoshis = parseInt(hrpToSat(value + divisor).toString());
    } catch (e) {
      satoshis = null;
      removeSatoshis = true;
    }
    millisatoshis = hrpToMillisat(value + divisor).toString();
  } else {
    satoshis = null;
    millisatoshis = null;
  }

  // reminder: left padded 0 bits
  const timestamp = wordsToIntBE(words.slice(0, 7));
  const timestampString = new Date(timestamp * 1000).toISOString();
  words = words.slice(7); // trim off the left 7 words

  const tags = [];
  let tagName, parser, tagLength, tagWords;
  // we have no tag count to go on, so just keep hacking off words
  // until we have none.
  while (words.length > 0) {
    const tagCode = words[0].toString();
    tagName = TAGNAMES[tagCode] || unknownTagName;
    parser = TAGPARSERS[tagCode] || getUnknownParser(tagCode);
    words = words.slice(1);

    tagLength = wordsToIntBE(words.slice(0, 2));
    words = words.slice(2);

    tagWords = words.slice(0, tagLength);
    words = words.slice(tagLength);

    // See: parsers for more comments
    tags.push({
      tagName,
      data: parser(tagWords, coinNetwork), // only fallback address needs coinNetwork
    });
  }

  let timeExpireDate, timeExpireDateString;
  // be kind and provide an absolute expiration date.
  // good for logs
  if (tagsContainItem(tags, TAGNAMES['6'])) {
    timeExpireDate = timestamp + tagsItems(tags, TAGNAMES['6']);
    timeExpireDateString = new Date(timeExpireDate * 1000).toISOString();
  }

  const toSign = new Uint8Array([
    ...new TextEncoder().encode(prefix),
    ...convert(wordsNoSig, 5, 8),
  ]);
  const payReqHash = await secp.utils.sha256(toSign);
  const sigPubkey = secp.recoverPublicKey(
    payReqHash,
    sigBuffer,
    recoveryFlag,
    false
  );
  if (
    tagsContainItem(tags, TAGNAMES['19']) &&
    tagsItems(tags, TAGNAMES['19']) !== bytesToHex(sigPubkey)
  ) {
    throw new Error(
      'Lightning Payment Request signature pubkey does not match payee pubkey'
    );
  }

  let finalResult: PaymentRequestObject = {
    paymentRequest,
    complete: true,
    prefix,
    wordsTemp: bech32.encode(
      'temp',
      wordsNoSig.concat(sigWords),
      Number.MAX_SAFE_INTEGER
    ),
    network: coinNetwork,
    millisatoshis,
    timestamp,
    timestampString,
    payeeNodeKey: bytesToHex(sigPubkey),
    signature: bytesToHex(sigBuffer),
    recoveryFlag,
    tags,
  };

  if (!removeSatoshis) {
    finalResult.satoshis = satoshis;
  }

  if (timeExpireDate) {
    finalResult = Object.assign(finalResult, {
      timeExpireDate,
      timeExpireDateString,
    });
  }

  return finalResult;
}

// decode will only have extra comments that aren't covered in encode comments.
// also if anything is hard to read I'll comment.
// function decode(
//   paymentRequest: string,
//   network?: Network
// ): {
//   paymentRequest: string;
//     sections: {
//       name: string;
//       letters?: string;
//       value?: any;
//       tag?: string;
//     }[];
//   readonly expiry: any;
//   readonly route_hints: any[];
// } {
//   if (typeof paymentRequest !== 'string')
//     throw new Error('Lightning Payment Request must be string');
//   if (paymentRequest.slice(0, 2).toLowerCase() !== 'ln')
//     throw new Error('Not a proper lightning payment request');

//   const sections = [];
//   const decoded = bech32.decode(paymentRequest, Number.MAX_SAFE_INTEGER);
//   paymentRequest = paymentRequest.toLowerCase();
//   const prefix = decoded.prefix;
//   let words = decoded.words;
//   let letters = paymentRequest.slice(prefix.length + 1);
//   let sigWords = words.slice(-104);
//   words = words.slice(0, -104);

//   // Without reverse lookups, can't say that the multipier at the end must
//   // have a number before it, so instead we parse, and if the second group
//   // doesn't have anything, there's a good chance the last letter of the
//   // coin type got captured by the third group, so just re-regex without
//   // the number.
//   let prefixMatches = prefix.match(/^ln(\S+?)(\d*)([a-zA-Z]?)$/);
//   if (prefixMatches && !prefixMatches[2])
//     prefixMatches = prefix.match(/^ln(\S+)$/);
//   if (!prefixMatches) {
//     throw new Error('Not a proper lightning payment request');
//   }

//   // "ln" section
//   sections.push({
//     name: 'lightning_network',
//     letters: 'ln',
//   });

//   // "bc" section
//   const bech32Prefix = prefixMatches[1];
//   let coinNetwork: Network|null = null;
//   if (!network) {
//     switch (bech32Prefix) {
//       case DEFAULTNETWORK.bech32:
//         coinNetwork = DEFAULTNETWORK;
//         break;
//       case TESTNETWORK.bech32:
//         coinNetwork = TESTNETWORK;
//         break;
//       case REGTESTNETWORK.bech32:
//         coinNetwork = REGTESTNETWORK;
//         break;
//       case SIMNETWORK.bech32:
//         coinNetwork = SIMNETWORK;
//         break;
//     }
//   } else {
//     if (
//       network.bech32 === undefined ||
//       network.pubKeyHash === undefined ||
//       network.scriptHash === undefined ||
//       !Array.isArray(network.validWitnessVersions)
//     )
//       throw new Error('Invalid network');
//     coinNetwork = network;
//   }
//   if (coinNetwork === null || coinNetwork.bech32 !== bech32Prefix) {
//     throw new Error('Unknown coin bech32 prefix');
//   }
//   sections.push({
//     name: 'coin_network',
//     letters: `${bech32Prefix}`,
//     value: coinNetwork,
//   });

//   // amount section
//   const value = prefixMatches[2];
//   let millisatoshis;
//   if (value) {
//     const divisor = prefixMatches[3];
//     millisatoshis = hrpToMillisat(value + divisor, true);
//     sections.push({
//       name: 'amount',
//       letters: `${prefixMatches[2] + prefixMatches[3]}`,
//       value: millisatoshis,
//     });
//   } else {
//     millisatoshis = null;
//   }

//   // "1" separator
//   sections.push({
//     name: 'separator',
//     letters: '1',
//   });

//   // timestamp
//   const timestamp = wordsToIntBE(words.slice(0, 7));
//   words = words.slice(7); // trim off the left 7 words
//   sections.push({
//     name: 'timestamp',
//     letters: letters.slice(0, 7),
//     value: timestamp,
//   });
//   letters = letters.slice(7);

//   let tagName, parser, tagLength, tagWords;
//   // we have no tag count to go on, so just keep hacking off words
//   // until we have none.
//   while (words.length > 0) {
//     const tagCode = words[0].toString();
//     tagName = TAGNAMES[tagCode] || 'unknown_tag';
//     parser = TAGPARSERS[tagCode] || getUnknownParser(tagCode);
//     words = words.slice(1);

//     tagLength = wordsToIntBE(words.slice(0, 2));
//     words = words.slice(2);

//     tagWords = words.slice(0, tagLength);
//     words = words.slice(tagLength);

//     sections.push({
//       name: tagName,
//       tag: letters[0],
//       letters: letters.slice(0, 1 + 2 + tagLength),
//       value: parser(tagWords), // see: parsers for more comments
//     });
//     letters = letters.slice(1 + 2 + tagLength);
//   }

//   // signature
//   sections.push({
//     name: 'signature',
//     letters: letters.slice(0, 104),
//     value: wordsToBuffer(sigWords, true),
//   });
//   letters = letters.slice(104);

//   // checksum
//   sections.push({
//     name: 'checksum',
//     letters: letters,
//   });

//   let result = {
//     paymentRequest,
//     sections,

//     get expiry() {
//       let exp = sections.find((s) => s.name === 'expiry');
//       if (exp) return getValue('timestamp') + exp.value;
//     },

//     get route_hints() {
//       return sections
//         .filter((s) => s.name === 'route_hint')
//         .map((s) => s.value);
//     },
//   };

//   for (let name in TAGCODES) {
//     if (name === 'route_hint') {
//       // route hints can be multiple, so this won't work for them
//       continue;
//     }

//     Object.defineProperty(result, name, {
//       get() {
//         return getValue(name);
//       },
//     });
//   }

//   return result;

//   function getValue(name:string) {
//     let section = sections.find((s) => s.name === name);
//     return section ? section.value : undefined;
//   }
// }

export { decode, hrpToMillisat };
