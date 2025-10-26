import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createBurnCheckedInstruction, createCloseAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58'; // For decoding private key
import { Buffer } from 'buffer';
import { programs } from '@metaplex/js';

// Polyfill Buffer for browser compatibility
window.Buffer = Buffer;

// Constants for the network
const NETWORK = "https://rpc.shyft.to?api_key=AwM0UoO6r1w8XNOA"; // Mainnet RPC URL
const connection = new Connection(NETWORK, 'confirmed');

let walletPublicKey = null;
let feePayerKeypair = null; // Store fee payer Keypair
let destinationAddress = null;
let fetchedTokens = [];

// --- Wallet Connection ---

async function connectWallet(eagerly = false) {
  try {
    let resp;
    if (eagerly) {
      resp = await window.solana.connect({ onlyIfTrusted: true });
    } else {
      resp = await window.solana.connect();
    }

    walletPublicKey = new PublicKey(resp.publicKey.toString());
    console.log('Connected to wallet:', walletPublicKey.toString());

    const publicKeyString = walletPublicKey.toString();
    const truncatedAddress = `${publicKeyString.slice(0, 4)}...${publicKeyString.slice(-4)}`;

    document.getElementById('after_connection').innerHTML = `
      <button type="button" id="connect-wallet"
              class="uk-button   uk-width-1-1 uk-button-primary drop-shadow-lg text-white-text font-bold ">${truncatedAddress}</button>
    `;

    // Fetch ATAs and display them
    await fetchAndDisplayATATokens();
  } catch (err) {
    if (eagerly) {
      console.log('Eager connect failed (wallet not trusted):', err.message);
    } else {
      console.error('Wallet connection error:', err);
      updateStatus('Wallet connection failed.', true);
    }
  }
}

// --- Token Fetching and Display ---

async function fetchAndDisplayATATokens() {
  if (!walletPublicKey) {
    console.error('Wallet not connected or public key not found');
    return;
  }

  const tokenList = document.getElementById('token-list');
  tokenList.innerHTML = '<p>Loading tokens...</p>';
  updateStatus('Fetching tokens...');

  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, { programId: TOKEN_PROGRAM_ID });

    fetchedTokens = tokenAccounts.value
      .map(account => ({
        mint: account.account.data.parsed.info.mint,
        tokenAccount: account.pubkey,
        amount: account.account.data.parsed.info.tokenAmount.amount,
        decimals: account.account.data.parsed.info.tokenAmount.decimals,
        isFrozen: account.account.data.parsed.info.state === "frozen",
        // More accurate NFT check
        isNFT: account.account.data.parsed.info.tokenAmount.decimals === 0 && account.account.data.parsed.info.tokenAmount.amount === "1"
      }));

    const splTokens = fetchedTokens.filter(token => !token.isFrozen && !token.isNFT);
    const nfts = fetchedTokens.filter(token => token.isNFT);
    const frozenTokens = fetchedTokens.filter(token => token.isFrozen);

    // Fetch metadata for all SPL tokens in parallel
    const metadataPromises = splTokens.map(token => fetchTokenMetadataFromOnChain(token.mint));
    const metadataList = await Promise.all(metadataPromises);

    // Display tokens with fetched metadata
    displayTokens(splTokens, metadataList);

    // Display NFTs and frozen tokens
    displayExcludedTokens(nfts, frozenTokens);
    updateStatus('Tokens loaded.');

  } catch (err) {
    console.error('Error fetching tokens:', err);
    updateStatus('Error fetching tokens.', true);
    tokenList.innerHTML = '<p class="text-red-500">Error fetching tokens.</p>';
  }
}

const { metadata: { Metadata } } = programs;

async function fetchTokenMetadataFromOnChain(mintAddress) {
  try {
    const metadataPDA = await Metadata.getPDA(new PublicKey(mintAddress));
    const metadataAccount = await Metadata.load(connection, metadataPDA);
    const metadataUri = metadataAccount.data.data.uri;

    // Handle potential URI issues (e.g., empty or non-standard)
    if (!metadataUri || !metadataUri.startsWith('http')) {
        // Try to fix common issues, like missing protocol
        let fixedUri = metadataUri.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
        // If still not http, we can't fetch it client-side
        if (!fixedUri.startsWith('http')) {
             console.warn(`Cannot fetch metadata from URI: ${metadataUri}`);
             return null;
        }
    }

    const metadataResponse = await fetch(metadataUri.replace(/\0/g, '')); // Remove null chars
    const metadata = await metadataResponse.json();

    return {
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.image
    };
  } catch (err) {
    console.error(`Error fetching on-chain metadata for ${mintAddress}:`, err);
    return null; // Return null on failure so Promise.all doesn't break
  }
}

function displayTokens(tokens, metadataList) {
  const tokenList = document.getElementById('token-list');
  tokenList.innerHTML = ''; // Clear existing list

  if (tokens.length === 0) {
      tokenList.innerHTML = '<p>No burnable SPL tokens found.</p>';
      return;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const metadata = metadataList[i];

    const tokenItem = document.createElement('li');
    const tokenName = metadata ? metadata.name : `Unknown (${token.mint.slice(0, 4)}...)`;
    const tokenSymbol = metadata ? metadata.symbol : 'N/A';
    const tokenLogo = metadata && metadata.image ? metadata.image : '';

    tokenItem.innerHTML = `
      <div class="cursor-pointer bg-[#090314] p-3 rounded-md flex items-center justify-between">
        <div class="flex items-center gap-4">
          <input type="checkbox" class="uk-checkbox token-checkbox" 
                 data-mint="${token.mint}" 
                 data-ata="${token.tokenAccount}" 
                 data-amount="${token.amount}" 
                 data-decimals="${token.decimals}">

          <div class="h-[40px] w-[40px]">
            ${tokenLogo ? `<img class="rounded-md" alt="${tokenName} logo" width="40" height="40" src="${tokenLogo}" style="aspect-ratio: 40 / 40; object-fit: cover;">` : '<div class="h-[40px] w-[40px] rounded-md bg-gray-700"></div>'}
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

function displayExcludedTokens(nfts, frozenTokens) {
  const excludedList = document.getElementById('excluded-list');
  excludedList.innerHTML = ''; // Clear existing list

  if (nfts.length > 0) {
    const nftSection = document.createElement('div');
    nftSection.innerHTML = '<h3 class="text-lg font-semibold text-white-text mb-2">NFTs</h3>';
    nfts.forEach(nft => {
      const nftItem = document.createElement('li');
      nftItem.innerHTML = `NFT (Mint: ${nft.mint.slice(0, 4)}...${nft.mint.slice(-4)})`;
      nftSection.appendChild(nftItem);
    });
    excludedList.appendChild(nftSection);
  }

  if (frozenTokens.length > 0) {
    const frozenSection = document.createElement('div');
    frozenSection.innerHTML = '<h3 class="text-lg font-semibold text-white-text mt-4 mb-2">Frozen Tokens</h3>';
    frozenTokens.forEach(token => {
      const frozenItem = document.createElement('li');
      frozenItem.innerHTML = `Frozen (Mint: ${token.mint.slice(0, 4)}...${token.mint.slice(-4)}, Amount: ${token.amount / Math.pow(10, token.decimals)})`;
      frozenSection.appendChild(frozenItem);
    });
    excludedList.appendChild(frozenSection);
  }

  if (nfts.length === 0 && frozenTokens.length === 0) {
      excludedList.innerHTML = '<p>No excluded accounts (NFTs or Frozen) found.</p>';
  }
}

// --- UI Interaction Functions ---

function setDestinationAddress(address) {
  try {
    destinationAddress = new PublicKey(address);
    console.log('Destination address set:', destinationAddress.toString());

    const desAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
    
    document.getElementById('des_Address_display_container').innerHTML = `
      <div style="display:flex; gap: 8px; align-items: center; justify-content: space-between; width: 100%;">
        <span class="text-white-text text-sm">Dest: ${desAddress}</span>
        <button type="button" id="change-destination" class="uk-button uk-button-danger uk-button-small">Change</button>
      </div>
    `;
    document.getElementById('des_Address_display_container').style.display = 'flex';
    document.getElementById('des_Address_input_container').style.display = 'none';
  } catch (err) {
    console.error('Invalid destination address:', err.message);
    updateStatus('Invalid destination address.', true);
  }
}

function setFeePayer(privateKey) {
  try {
    const privateKeyBytes = bs58.decode(privateKey);
    feePayerKeypair = Keypair.fromSecretKey(privateKeyBytes);
    const pubkeyStr = feePayerKeypair.publicKey.toString();
    console.log('Fee payer set:', pubkeyStr);
    
    const feepayerAddress = `${pubkeyStr.slice(0, 4)}...${pubkeyStr.slice(-4)}`;

    document.getElementById('fee_payer_display_container').innerHTML = `
      <div style="display:flex; gap: 8px; align-items: center; justify-content: space-between; width: 100%;">
        <span class="text-white-text text-sm">Fee: ${feepayerAddress}</span>
        <button type="button" id="change-fee-payer" class="uk-button uk-button-danger uk-button-small">Change</button>
      </div>
    `;
    document.getElementById('fee_payer_display_container').style.display = 'flex';
    document.getElementById('fee_payer_input_container').style.display = 'none';
  } catch (err) {
    console.error('Invalid private key:', err.message);
    updateStatus('Invalid private key.', true);
  }
}

function updateStatus(message, isError = false) {
    const statusEl = document.getElementById('status-message');
    statusEl.innerText = message;
    statusEl.className = isError ? 'text-red-500 p-2 rounded-md h-[36px]' : 'text-green-500 p-2 rounded-md h-[36px]';
}

// --- Transaction Logic ---

async function burnAndCloseTokensInBatches() {
  if (!walletPublicKey) {
    updateStatus('Please connect your wallet first.', true);
    return;
  }

  // --- Defaulting Logic ---
  // If destinationAddress is not set, default to walletPublicKey
  const destination = destinationAddress ? destinationAddress : walletPublicKey;
  // If feePayerKeypair is not set, default to walletPublicKey. 
  // We'll pass feePayerKeypair (null or object) to sendTransactionBatches to handle signing.
  const feePayer = feePayerKeypair ? feePayerKeypair.publicKey : walletPublicKey;

  console.log('Using Destination:', destination.toString());
  console.log('Using Fee Payer:', feePayer.toString());

  // --- Selection Logic ---
  const selectedCheckboxes = document.querySelectorAll('#token-list .token-checkbox:checked');
  if (selectedCheckboxes.length === 0) {
      updateStatus('No tokens selected to burn.', true);
      return;
  }

  updateStatus(`Preparing ${selectedCheckboxes.length} token accounts...`);

  const instructionsPerTx = 5; // Reduced for safety (2 instructions per token)
  const rpsLimit = 35; // RPC rate limit
  let blockhash;
  try {
      blockhash = (await connection.getLatestBlockhash()).blockhash;
  } catch (e) {
      console.error("Failed to get blockhash:", e);
      updateStatus('Failed to get network blockhash.', true);
      return;
  }
  
  console.log('Using blockhash:', blockhash);

  const transactionBatches = [];
  let currentTransaction = new Transaction({
    feePayer: feePayer,
    recentBlockhash: blockhash,
  });
  let instructionCount = 0;

  for (const checkbox of selectedCheckboxes) {
    const { mint, ata, amount, decimals } = checkbox.dataset;

    try {
      const tokenMint = new PublicKey(mint);
      const tokenATA = new PublicKey(ata);
      const amountToBurn = BigInt(amount); // Use BigInt for large numbers

      // 1. Add Burn Instruction (if amount > 0)
      if (amountToBurn > 0) {
        currentTransaction.add(createBurnCheckedInstruction(
          tokenATA,
          tokenMint,
          walletPublicKey,
          amountToBurn,
          parseInt(decimals)
        ));
        instructionCount++;
      }

      // 2. Add Close Instruction
      currentTransaction.add(createCloseAccountInstruction(
        tokenATA,
        destination, // Send recovered SOL to destination
        walletPublicKey // Owner of the ATA
      ));
      instructionCount++;

      // Check if transaction is full
      if (instructionCount >= instructionsPerTx) {
        transactionBatches.push(currentTransaction);
        // Start a new transaction
        currentTransaction = new Transaction({
          feePayer: feePayer,
          recentBlockhash: blockhash,
        });
        instructionCount = 0;
      }

    } catch (err) {
      console.error('Error creating instruction:', err);
      updateStatus(`Error on token ${mint}.`, true);
    }
  }

  // Add the last transaction if it has instructions
  if (instructionCount > 0) {
    transactionBatches.push(currentTransaction);
  }

  if (transactionBatches.length === 0) {
      updateStatus('No valid transactions to send.', true);
      return;
  }

  console.log(`Ready to send ${transactionBatches.length} transaction(s).`);
  await sendTransactionBatches(transactionBatches, rpsLimit, feePayerKeypair);
}

async function sendTransactionBatches(transactionBatches, rpsLimit, feePayerKeypair) {
  const batchSize = Math.min(transactionBatches.length, rpsLimit);
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < transactionBatches.length; i += batchSize) {
    const currentBatch = transactionBatches.slice(i, i + batchSize);
    const batchNum = i / batchSize + 1;
    const totalBatches = Math.ceil(transactionBatches.length / batchSize);

    updateStatus(`Waiting for wallet to sign batch ${batchNum}/${totalBatches}...`);

    let signedTransactions;
    try {
      signedTransactions = await window.solana.signAllTransactions(currentBatch);
      console.log('Signed transactions:', signedTransactions);
    } catch (err) {
      console.error('Error signing transactions with wallet:', err);
      updateStatus('Wallet signing rejected or failed.', true);
      continue; // Skip this batch
    }

    // --- Conditional Partial Signing ---
    // If a *separate* fee payer was provided, we need their signature too.
    if (feePayerKeypair) {
      console.log('Partially signing with fee payer keypair...');
      try {
        for (const tx of signedTransactions) {
            tx.partialSign(feePayerKeypair);
        }
      } catch (err) {
          console.error('Error signing with fee payer keypair:', err);
          updateStatus('Fee payer signing failed.', true);
          continue; // Skip this batch
      }
    }
    // If no feePayerKeypair, the wallet's signature is all that's needed (it's the fee payer).

    updateStatus(`Sending batch ${batchNum}/${totalBatches}...`);
    
    const txPromises = signedTransactions.map(async (signedTransaction, index) => {
      try {
        const serializedTx = signedTransaction.serialize();
        const signature = await connection.sendRawTransaction(serializedTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
        await connection.confirmTransaction(signature, 'confirmed');

        console.log(`Transaction ${index + 1} (Batch ${batchNum}) confirmed:`, signature);
        successCount++;
      } catch (err) {
        console.error(`Error sending transaction ${index + 1} (Batch ${batchNum}):`, err);
        errorCount++;
      }
    });

    try {
      await Promise.all(txPromises);
    } catch (err) {
      console.error('Error sending transaction batch:', err);
    }

    if (errorCount > 0) {
        updateStatus(`Batch ${batchNum} sent with ${errorCount} error(s).`, true);
    } else {
        updateStatus(`Batch ${batchNum} confirmed successfully.`);
    }

    // Wait to respect the rate limit
    if (i + batchSize < transactionBatches.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
  }

  // Final status update
  if (successCount > 0) {
      updateStatus(`Process finished: ${successCount} tx(s) successful, ${errorCount} failed.`, errorCount > 0);
      // Refresh token list
      await fetchAndDisplayATATokens();
  } else {
      updateStatus(`Process failed: ${errorCount} error(s).`, true);
  }
}

// --- Event Listeners (Using Delegation) ---

// Handle clicks on dynamic elements
document.addEventListener('click', (event) => {
    // Connect Wallet button
    if (event.target.id === 'connect-wallet') {
        connectWallet();
    }
    
    // Burn & Close button
    if (event.target.id === 'burn-close-btn') {
        burnAndCloseTokensInBatches();
    }

    // "Change" button for Fee Payer
    if (event.target.id === 'change-fee-payer') {
        feePayerKeypair = null; // Clear the keypair
        document.getElementById('fee_payer_display_container').style.display = 'none';
        document.getElementById('fee_payer_input_container').style.display = 'block';
        document.getElementById('fee-payer-key').value = ''; // Clear input
        console.log('Fee payer cleared.');
    }

    // "Change" button for Destination Address
    if (event.target.id === 'change-destination') {
        destinationAddress = null; // Clear the address
        document.getElementById('des_Address_display_container').style.display = 'none';
        document.getElementById('des_Address_input_container').style.display = 'block';
        document.getElementById('destination-address').value = ''; // Clear input
        console.log('Destination address cleared.');
    }
});

// Handle 'change' events on inputs
document.addEventListener('change', (event) => {
    // Destination Address input
    if (event.target.id === 'destination-address') {
        setDestinationAddress(event.target.value);
    }

    // Fee Payer private key input
    if (event.target.id === 'fee-payer-key') {
        setFeePayer(event.target.value);
    }

    // "Select All" checkbox
    if (event.target.id === 'select-all-checkbox') {
        const isChecked = event.target.checked;
        document.querySelectorAll('.token-checkbox').forEach(checkbox => {
            checkbox.checked = isChecked;
        });
    }
});

// Try to auto-connect on page load
window.onload = () => {
    connectWallet(true); // true for eager/trusted connect
};
