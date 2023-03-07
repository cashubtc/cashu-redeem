import type { RequestContext } from '@vercel/edge';
import { CashuMint, CashuWallet } from '@gandlaf21/cashu-ts';
import { bech32 } from '../lib/bech32/bech32';
import { decode } from '../lib/bolt11/bolt11';
import type { Proof } from '@gandlaf21/cashu-ts';

export const config = {
  runtime: 'edge',
  regions: ['lhr1', 'syd1', 'cpt1', 'bom1', 'gru1', 'cle1'],
};

let wallet: CashuWallet;
let mintUrl: string;
let proofs: Proof[];
let payAmount = 0;
let tokenAmount = 0;

const isLnurl = (address: string) =>
  address.split('@').length === 2 || address.toLowerCase().startsWith('lnurl1');

const getInvoiceFromLnurl = async (
  address = '',
  amount = 0
): Promise<string> => {
  try {
    if (!address) throw `Error: address is required!`;
    if (!amount) throw `Error: amount is required!`;
    if (!isLnurl(address)) throw 'Error: invalid address';
    let data: {
      tag: string;
      minSendable: number;
      maxSendable: number;
      callback: string;
      pr: string;
    };
    if (address.split('@').length === 2) {
      const [user, host] = address.split('@');
      const response = await fetch(
        `https://${host}/.well-known/lnurlp/${user}`
      );
      if (!response.ok) throw 'Unable to reach host';
      const json = await response.json();
      data = json;
    } else {
      const dataPart = bech32.decode(address, 20000).words;
      const requestByteArray = bech32.fromWords(dataPart);
      const host = new TextDecoder().decode(new Uint8Array(requestByteArray));
      const response = await fetch(host);
      if (!response.ok) throw 'Unable to reach host';
      const json = await response.json();
      data = json;
    }
    if (
      data.tag == 'payRequest' &&
      data.minSendable <= amount * 1000 &&
      amount * 1000 <= data.maxSendable
    ) {
      const response = await fetch(`${data.callback}?amount=${amount * 1000}`);
      if (!response.ok) throw 'Unable to reach host';
      const json = await response.json();
      return json.pr ?? new Error('Unable to get invoice');
    } else throw 'Host unable to make a lightning invoice for this amount.';
  } catch (err) {
    console.error(err);
    return '';
  }
};

const checkToken = async (tokenBase64: string) => {
  try {
    const token = JSON.parse(atob(tokenBase64));
    mintUrl = token.mints[0].url;
    const mint = new CashuMint(mintUrl);
    const keys = await mint.getKeys();
    wallet = new CashuWallet(keys, mint);
    proofs = token.proofs ?? [];
    const spentProofs = await wallet.checkProofsSpent(proofs);
    if (spentProofs.length) {
      return false;
    }
    tokenAmount = proofs.reduce(
      (accumulator: number, currentValue: Proof) =>
        accumulator + currentValue.amount,
      0
    );
    const feeAmount = Math.ceil(Math.max(2, tokenAmount * 0.02));
    payAmount = tokenAmount - feeAmount;
    return true;
  } catch (err) {
    return false;
  }
};

const goRedeem = async (tokenBase64: string, address: string) => {
  try {
    const isValidToken = await checkToken(tokenBase64);
    if (!isValidToken) throw 'invalid token';
    let invoice = '';
    if (isLnurl(address)) {
      invoice = await getInvoiceFromLnurl(address, payAmount);
    } else invoice = address;
    if (!wallet || !invoice || !payAmount)
      throw 'OOPS! This should not happen!';
    const decodedInvoice = await decode(invoice);
    const fee = await wallet.getFee(invoice);
    const requestedSats = decodedInvoice.satoshis || 0;
    if (requestedSats + fee > tokenAmount)
      throw 'Not enough to pay the invoice.';
    const { isPaid } = await wallet.payLnInvoice(invoice, proofs);
    if (isPaid) {
      return 'Payment successful!';
    } else {
      throw 'Payment failed';
    }
  } catch (err) {
    console.error(err);
    return `${err}`;
  }
};

export default async (req: Request, context: RequestContext) => {
  try {
    if (req.method !== 'POST') {
      return new Response(`{error: "Please use POST on this endpoint"}`, {
        status: 400,
      });
    }
    const { token, ln } = await req.json();
    if (!token || !ln)
      return new Response(
        `{error: "Both 'token' and 'ln' fields must be present"}`,
        { status: 400 }
      );

    let r;
    context.waitUntil(goRedeem(token, ln).then((result) => (r = result)));
    if (!r) throw 'Unknown Error';
    return new Response(`{ok: true}`, { status: 400 });
  } catch (error) {
    return new Response(`{error:${error}}`, { status: 500 });
  }
};
