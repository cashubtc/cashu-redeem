import './style.css';
import { CashuMint, CashuWallet, getDecodedToken } from '@cashu/cashu-ts';
import { bech32 } from '../lib/bech32/bech32';
import { decode } from '../lib/bolt11/bolt11';
// import bolt11 from 'bolt11';
import type { Proof } from '@cashu/cashu-ts';
// https://8333.space:3338/check

document.querySelector<HTMLDivElement>('#app')!.innerHTML = /*html*/ `
  <div>
    <img src="/rounded_192x192.png" class="logo" alt="Cashu logo" width="192" height="192" />
    <h1>Cashu Redeem</h1>
    <div id="tokenWrapper" class="text-wrapper">
      <span id="token" role="textbox" aria-roledescription="input" contenteditable></span>
      <button id="tokenRemover" class="text-remover hidden">&times;</button>
    </div>
    <p id="tokenStatus"></p>
    <div id="lightningSection" class="hidden">
      <div id="lnurlWrapper" class="text-wrapper">
        <span id="lnurl" role="textbox" aria-roledescription="input" contenteditable></span>
        <button id="lnurlRemover" class="text-remover hidden">&times;</button>
      </div>
      <button id="redeem" class="button-primary">REDEEM</button>
    </div>
    <p>Cashu is a free and open-source Chaumian ecash system built for Bitcoin. Cashu offers near-perfect privacy for users of custodial Bitcoin applications. Nobody needs to know who you are, how much funds you have, and with whom you transact with.</p>
    <p>Here you can redeem a Cashu token into your lightning wallet.</p>
    <p>Learn more at <a href="https://cashu.space">cashu.space</a></p>
  </div>
`;

let wallet: CashuWallet;
let mintUrl: string;
let proofs: Proof[];
let payAmount = 0;
let tokenAmount = 0;

const tokenInput = document.querySelector<HTMLSpanElement>('#token');
const tokenStatus = document.querySelector<HTMLHeadingElement>('#tokenStatus');
const lightningSection =
  document.querySelector<HTMLDivElement>('#lightningSection');
const lnurlInput = document.querySelector<HTMLSpanElement>('#lnurl');

const setTokenStatus = (msg = '') => {
  tokenStatus!.innerText = msg;
};

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

document.querySelectorAll('button.text-remover').forEach((btn) =>
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (ev === null) return;
    const btn: HTMLButtonElement = ev.target as HTMLButtonElement;
    const textContainer: HTMLSpanElement =
      btn.previousElementSibling as HTMLSpanElement;
    textContainer.innerText = '';
  })
);

const isLnurl = (address: string) =>
  address.split('@').length === 2 || address.toLowerCase().startsWith('lnurl1');

const processToken = async (event?: Event) => {
  if (event) event.preventDefault();
  lightningSection?.classList.add('hidden');
  document
    .querySelector<HTMLButtonElement>('#tokenRemover')!
    .classList.add('hidden');
  setTokenStatus('Checking token, one moment please...');
  try {
    const tokenEncoded = tokenInput!.innerText;
    if (!tokenEncoded) {
      setTokenStatus();
      return;
    }
    document
      .querySelector<HTMLButtonElement>('#tokenRemover')!
      .classList.remove('hidden');
    const token = getDecodedToken(tokenEncoded)
    console.log('token :>> ', token);
    if (!(token.token.length > 0) || !(token.token[0].proofs.length > 0) || !(token.token[0].mint.length > 0)) {
      throw 'Token format invalid'
    }
    mintUrl = token.token[0].mint;
    const mint = new CashuMint(mintUrl);
    const keys = await mint.getKeys();
    wallet = new CashuWallet(keys, mint);
    proofs = token.token[0].proofs ?? [];
    const spentProofs = await wallet.checkProofsSpent(proofs);
    if (spentProofs.length && spentProofs.length === proofs.length) {
      throw 'Token already spent';
    }
    if (spentProofs.length) {
      throw spentProofs.join(', ');
    }
    tokenAmount = proofs.reduce(
      (accumulator: number, currentValue: Proof) =>
        accumulator + currentValue.amount,
      0
    );
    lightningSection?.classList.remove('hidden');
    const feeAmount = Math.ceil(Math.max(2, tokenAmount * 0.02));
    payAmount = tokenAmount - feeAmount;
    setTokenStatus(
      `Receive ${payAmount} sats (incl. ${feeAmount} sats network fees) via Lightning.`
    );
  } catch (err) {
    console.error(err);
    let errMsg = `${err}`;
    if (
      errMsg.startsWith('InvalidCharacterError') ||
      errMsg.startsWith('SyntaxError:')
    )
      errMsg = 'Invalid Token!';
    setTokenStatus(errMsg);
  }
};

tokenInput!.oninput = processToken;

lnurlInput!.oninput = () => {
  if (lnurlInput?.innerText)
    document
      .querySelector<HTMLButtonElement>('#lnurlRemover')!
      .classList.remove('hidden');
  else
    document
      .querySelector<HTMLButtonElement>('#lnurlRemover')!
      .classList.add('hidden');
};

document.querySelector<HTMLButtonElement>('#redeem')!.onclick = async (
  event
) => {
  event.preventDefault();
  setTokenStatus('Attempting payment...');
  try {
    let invoice = '';
    let address = lnurlInput?.innerText ?? '';
    if (isLnurl(address)) {
      invoice = await getInvoiceFromLnurl(address, payAmount);
    } else invoice = address;
    if (!wallet || !invoice || !payAmount) throw 'OOPS!';
    const decodedInvoice = await decode(invoice);
    const fee = await wallet.getFee(invoice);
    const requestedSats = decodedInvoice.satoshis || 0;
    if (requestedSats + fee > tokenAmount)
      throw 'Not enough to pay the invoice.';
    const { isPaid } = await wallet.payLnInvoice(invoice, proofs);
    if (isPaid) {
      setTokenStatus('Payment successful!');
    } else {
      setTokenStatus('Payment failed');
    }
  } catch (err) {
    console.error(err);
  }
};

{
  let params = new URL(document.location.href).searchParams;
  const token = decodeURIComponent(params.get('token') ?? '');
  const to = decodeURIComponent(params.get('ln') || params.get('lightning') || params.get('to') || '');
  if (token) {
    tokenInput!.innerText = token;
    processToken();
  }
  if (to) {
    lnurlInput!.innerText = to;
  }
}
