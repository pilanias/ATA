import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createBurnCheckedInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58'; // For decoding private key
import { Buffer } from 'buffer';
import { programs } from '@metaplex/js';

// Polyfill Buffer for browser compatibility
window.Buffer = Buffer;

// Constants for the network
// const NETWORK = "https://endpoints.omniatech.io/v1/sol/devnet/31c23983f2bb40348812359454e4592e"; // Mainnet RPC URL
const NETWORK = "https://rpc.shyft.to?api_key=AwM0UoO6r1w8XNOA"; // Mainnet RPC URL

const connection = new Connection(NETWORK, 'confirmed');

let walletPublicKey = null;
let feePayerKeypair = null; // Store fee payer Keypair
let destinationAddress = null;
let fetchedTokens = [];

// Connect Phantom wallet
async function connectWallet() {
  try {
    const resp = await window.solana.connect();
    walletPublicKey = new PublicKey(resp.publicKey.toString());
    console.log('Connected to wallet:', walletPublicKey.toString());

    const publicKeyString = walletPublicKey.toString(); // Convert to string once

    // Check length and slice properly
    const truncatedAddress = publicKeyString.length > 30
      ? `${publicKeyString.slice(0, 4)}...${publicKeyString.slice(-4)}`
      : "na";


    after_connection.innerHTML = `
      <button type="button" id="connect-wallet"
              class="uk-button   uk-width-1-1 uk-button-primary drop-shadow-lg text-white-text font-bold ">${truncatedAddress}</button></div>
    `;

    // Fetch ATAs and display them
    await fetchAndDisplayATATokens();
  } catch (err) {
    console.error('Wallet connection error:', err);
  }
}



// Fetch and display Associated Token Accounts (ATA)
async function fetchAndDisplayATATokens() {
  if (!walletPublicKey) {
    console.error('Wallet not connected or public key not found');
    return;
  }

  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, { programId: TOKEN_PROGRAM_ID });

    fetchedTokens = tokenAccounts.value
      .map(account => ({
        mint: account.account.data.parsed.info.mint,
        tokenAccount: account.pubkey,
        amount: account.account.data.parsed.info.tokenAmount.amount,
        decimals: account.account.data.parsed.info.tokenAmount.decimals,
        isFrozen: account.account.data.parsed.info.state === "frozen",
        isNFT: account.account.data.parsed.info.tokenAmount.amount === "1" // Assume zero amount means it's an NFT
      }));

    const splTokens = fetchedTokens.filter(token => !token.isFrozen && !token.isNFT);
    const nfts = fetchedTokens.filter(token => token.isNFT);
    const frozenTokens = fetchedTokens.filter(token => token.isFrozen);

    // Fetch metadata for all SPL tokens in parallel
    const metadataPromises = splTokens.map(token => fetchTokenMetadataFromOnChain(token.mint));

    // Wait for all metadata fetches to complete
    const metadataList = await Promise.all(metadataPromises);

    // Display tokens with fetched metadata
    displayTokens(splTokens, metadataList);

    // Display NFTs and frozen tokens in the excluded section
    displayExcludedTokens(nfts, frozenTokens);

  } catch (err) {
    console.error('Error fetching tokens:', err);
  }
}

const { metadata: { Metadata } } = programs;

// Function to fetch metadata from on-chain
async function fetchTokenMetadataFromOnChain(mintAddress) {
  try {
    // Derive the Metadata PDA (Program Derived Address)
    const metadataPDA = await Metadata.getPDA(new PublicKey(mintAddress));

    // Fetch metadata account info from connection
    const metadataAccount = await Metadata.load(connection, metadataPDA);

    // The URI for metadata is inside metadataAccount
    const metadataUri = metadataAccount.data.data.uri;

    // Fetch JSON data from the URI (usually hosted on IPFS/Arweave)
    const metadataResponse = await fetch(metadataUri);
    const metadata = await metadataResponse.json();

    return {
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.image // Image URL
    };
  } catch (err) {
    console.error('Error fetching on-chain metadata:', err);
    return null;
  }
}

// Display tokens with metadata fetched in parallel
async function displayTokens(tokens, metadataList) {
  const tokenList = document.getElementById('token-list');
  tokenList.innerHTML = ''; // Clear existing list

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const metadata = metadataList[i];

    const tokenItem = document.createElement('li');
    const tokenName = metadata ? metadata.name : `Unknown`;
    const tokenSymbol = metadata ? metadata.symbol : 'N/A';
    const tokenLogo = metadata && metadata.image ? metadata.image : '';


    // Display the token info
    tokenItem.innerHTML = `
      
      <div class=" cursor-pointer bg-[#090314] p-3 rounded-md flex items-center justify-between">
  <div class="flex items-center gap-4">
    <div class="h-[40px] w-[40px]">
      ${tokenLogo ? `<img class="rounded-md" alt="${tokenName} logo" width="40" height="40" src="${tokenLogo}" style="aspect-ratio: 40 / 40; object-fit: cover;">` : ''}
      </div>
      <div>
      <h4 class="font-semibold text-white-text">${tokenName}</h4>
      <p class="text-sm text-gray-400">${tokenSymbol}</p>
      </div>
    </div>
    <div class="flex flex-col items-end">
    <p class="text-sm  text-white-text">Amount: ${token.amount / Math.pow(10, token.decimals)}</p>
    </div>
  </div>
    `;

    tokenList.appendChild(tokenItem);
  }
}

// Display NFTs and frozen tokens in the excluded section
async function displayExcludedTokens(nfts, frozenTokens) {
  const excludedList = document.getElementById('excluded-list');
  excludedList.innerHTML = ''; // Clear existing list

  if (nfts.length > 0) {
    const nftSection = document.createElement('div');
    nftSection.innerHTML = '<h3>NFTs</h3>';
    nfts.forEach(nft => {
      const nftItem = document.createElement('li');
      nftItem.innerHTML = `NFT (Mint: ${nft.mint})`;
      nftSection.appendChild(nftItem);
    });
    excludedList.appendChild(nftSection);
  }

  if (frozenTokens.length > 0) {
    const frozenSection = document.createElement('div');
    frozenSection.innerHTML = '<h3>Frozen Tokens</h3>';
    frozenTokens.forEach(token => {
      const frozenItem = document.createElement('li');
      frozenItem.innerHTML = `Frozen Token (Mint: ${token.mint}, Amount: ${token.amount / Math.pow(10, token.decimals)})`;
      frozenSection.appendChild(frozenItem);
    });
    excludedList.appendChild(frozenSection);
  }
}

// Set destination address
function setDestinationAddress(address) {
  try {
    destinationAddress = new PublicKey(address);

    console.log('Destination address set:', destinationAddress.toString());
    const destination_Address = destinationAddress.toString();
    // Check length and slice properly
    const desAddress = destination_Address.length > 10
      ? `${destination_Address.slice(0, 4)}...${destination_Address.slice(-4)}`
      : "na";


      des_Address.innerHTML = `
      <div style="display:flex; gap: 8px;" >
      <button type="button" id="fee-payer"
              class="uk-button   uk-width-1-1 uk-button-primary drop-shadow-lg text-white-text font-bold ">Destination wallet: ${desAddress}</button> <button type="button" id="fee-payer"
              class="uk-button   uk-width-1-1 uk-button-primary drop-shadow-lg text-white-text font-bold " style="width: auto;">Change</button>
              </div>
    `;
  } catch (err) {
    console.error('Invalid destination address:', err.message);
  }
}

// Set fee payer from private key input
function setFeePayer(privateKey) {
  try {
    const privateKeyBytes = bs58.decode(privateKey);
    feePayerKeypair = Keypair.fromSecretKey(privateKeyBytes);
    console.log('Fee payer set:', feePayerKeypair.publicKey.toString());
    const feepayerString = feePayerKeypair.publicKey.toString(); // Convert to string once

    // Check length and slice properly
    const feepayerAddress = feepayerString.length > 10
      ? `${feepayerString.slice(0, 4)}...${feepayerString.slice(-4)}`
      : "na";


      fee_payer.innerHTML = `
      <div style="display:flex; gap: 8px;" >
      <button type="button" id="fee-payer"
              class="uk-button   uk-width-1-1 uk-button-primary drop-shadow-lg text-white-text font-bold ">Fee wallet: ${feepayerAddress}</button> <button type="button" id="fee-payer"
              class="uk-button   uk-width-1-1 uk-button-primary drop-shadow-lg text-white-text font-bold " style="width: auto;">Change</button>
              </div>
    `;
  } catch (err) {
    console.error('Invalid private key:', err.message);
  }
}

// Burn and close ATAs in batches
async function burnAndCloseTokensInBatches() {
  if (!destinationAddress || !feePayerKeypair) {
    console.error('Destination address or fee payer is not set.');
    return;
  }

  const instructionsPerTx = 10; // Maximum instructions per transaction
  const rpsLimit = 35; // RPC rate limit
  const blockhash = (await connection.getLatestBlockhash()).blockhash;
  console.log('Using blockhash:', blockhash);

  const transactionBatches = [];

  // Filter out NFTs and frozen tokens
  const splTokens = fetchedTokens.filter(token => !token.isFrozen && !token.isNFT);

  for (let i = 0; i < splTokens.length; i += instructionsPerTx) {
    const tokenBatch = splTokens.slice(i, i + instructionsPerTx);
    const transaction = new Transaction({
      feePayer: feePayerKeypair.publicKey, // Set fee payer
      recentBlockhash: blockhash,
    });

    for (const token of tokenBatch) {
      try {
        const tokenMint = new PublicKey(token.mint);
        const ata = new PublicKey(token.tokenAccount);
        const amountToBurn = parseInt(token.amount);

        if (amountToBurn > 0) {
          const burnInstruction = createBurnCheckedInstruction(
            ata,
            tokenMint,
            walletPublicKey,
            amountToBurn,
            token.decimals
          );

          transaction.add(burnInstruction);
        }

        const closeInstruction = createCloseAccountInstruction(
          ata,
          destinationAddress,
          walletPublicKey
        );

        transaction.add(closeInstruction);

      } catch (err) {
        console.error('Error in transaction creation:', err);
      }
    }

    transactionBatches.push(transaction);
  }

  await sendTransactionBatches(transactionBatches, rpsLimit);
}



// Send transactions in parallel with rate limiting
async function sendTransactionBatches(transactionBatches, rpsLimit) {
  const batchSize = Math.min(transactionBatches.length, rpsLimit);

  for (let i = 0; i < transactionBatches.length; i += batchSize) {
    const currentBatch = transactionBatches.slice(i, i + batchSize);

    let signedTransactions;
    try {
      // Let Phantom Wallet sign all transactions
      signedTransactions = await window.solana.signAllTransactions(currentBatch);
      console.log('Signed transactions:', signedTransactions);
    } catch (err) {
      console.error('Error signing transactions with Phantom:', err);
      continue;
    }

    
    // Check if the feePayerKeypair is correctly initialized
    if (!feePayerKeypair || !feePayerKeypair.publicKey) {
      console.error('Fee payer keypair is not initialized correctly');
      return;
    }

    // Send all transactions in parallel with fee payer signature
    const txPromises = signedTransactions.map(async (signedTransaction, index) => {
      try {
        // Ensure feePayerKeypair is used to sign
        signedTransaction.partialSign(feePayerKeypair);

        const serializedTx = signedTransaction.serialize();
        const signature = await connection.sendRawTransaction(serializedTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction(signature);

        console.log(`Transaction ${index + 1} confirmed with signature:`, signature);
      } catch (err) {
        console.error(`Error sending transaction ${index + 1}:`, err);
      }
    });

    try {
      await Promise.all(txPromises);
    } catch (err) {
      console.error('Error sending transaction batch:', err);
    }

    // Wait to respect the rate limit
    if (i + batchSize < transactionBatches.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
  }
}



// Event listeners for UI controls


document.getElementById('burn-close-btn').addEventListener('click', burnAndCloseTokensInBatches);
document.getElementById('destination-address').addEventListener('change', (event) => setDestinationAddress(event.target.value));
document.getElementById('connect-wallet').addEventListener('click', connectWallet);
document.getElementById('fee-payer-key').addEventListener('change', (event) => setFeePayer(event.target.value));

// Fetch tokens when the page loads
window.onload = connectWallet;