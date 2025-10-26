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

    // --- UI UPDATE --- (Using new Tailwind classes)
    document.getElementById('after_connection').innerHTML = `
      <button type="button" id="connect-wallet"
              class="w-full bg-[var(--accent)] text-black font-semibold py-2.5 px-4 rounded-lg shadow-lg transition-colors duration-200 hover:bg-[var(--accent-hover)]">
              Connected: ${truncatedAddress}
      </button>
    `;

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
  tokenList.innerHTML = '<p class="p-4 text-center">Loading tokens...</p>';
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
        isNFT: account.account.data.parsed.info.tokenAmount.decimals === 0 && account.account.data.parsed.info.tokenAmount.amount === "1"
      }));

    const splTokens = fetchedTokens.filter(token => !token.isFrozen && !token.isNFT);
    const nfts = fetchedTokens.filter(token => token.isNFT);
    const frozenTokens = fetchedTokens.filter(token => token.isFrozen);

    const metadataPromises = splTokens.map(token => fetchTokenMetadataFromOnChain(token.mint));
    const metadataList = await Promise.all(metadataPromises);

    displayTokens(splTokens, metadataList);
    displayExcludedTokens(nfts, frozenTokens);
    updateStatus('Tokens loaded. Select tokens to burn.');

  } catch (err)
 {
    console.error('Error fetching tokens:', err);
    updateStatus('Error fetching tokens.', true);
    tokenList.innerHTML = '<p class="p-4 text-center text-[var(--error)]">Error fetching tokens.</p>';
  }
}

const { metadata: { Metadata } } = programs;

async function fetchTokenMetadataFromOnChain(mintAddress) {
  try {
    const metadataPDA = await Metadata.getPDA(new PublicKey(mintAddress));
    const metadataAccount = await Metadata.load(connection, metadataPDA);
    const metadataUri = metadataAccount.data.data.uri.replace(/\0/g, ''); // Clean null chars

    if (!metadataUri) return null;
    
    let fetchUri = metadataUri.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');

    if (!fetchUri.startsWith('http')) {
        console.warn(`Cannot fetch metadata from URI: ${fetchUri}`);
        return null;
    }

    const metadataResponse = await fetch(fetchUri);
    if (!metadataResponse.ok) {
        console.warn(`Failed to fetch metadata from ${fetchUri}`);
        return null;
    }
    const metadata = await metadataResponse.json();

    return {
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.image ? metadata.image.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/') : null
    };
  } catch (err) {
    console.error(`Error fetching on-chain metadata for ${mintAddress}:`, err);
    return null;
  }
}

function displayTokens(tokens, metadataList) {
  const tokenList = document.getElementById('token-list');
  tokenList.innerHTML = ''; 

  if (tokens.length === 0) {
      tokenList.innerHTML = '<p class="p-4 text-center">No burnable SPL tokens found.</p>';
      return;
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const metadata = metadataList[i];

    const tokenItem = document.createElement('li');
    // --- UI UPDATE --- (New card styling for each token)
    const tokenName = metadata ? metadata.name : `Unknown (${token.mint.slice(0, 4)}...)`;
    const tokenSymbol = metadata ? metadata.symbol : 'N/A';
    const tokenLogo = metadata && metadata.image ? metadata.image : '';

    tokenItem.innerHTML = `
      <div class="cursor-pointer p-3 rounded-lg flex items-center justify-between hover:bg-[var(--bg-primary)] transition-colors duration-150 border-b border-[var(--border-color)]">
        <div class="flex items-center gap-4 flex-1 min-w-0">
          <input type="checkbox" class="token-checkbox w-4 h-4 text-[var(--accent)] bg-[var(--bg-primary)] border-[var(--border-color)] rounded focus:ring-[var(--accent)] focus:ring-2 flex-shrink-0" 
                 data-mint="${token.mint}" 
                 data-ata="${token.tokenAccount}" 
                 data-amount="${token.amount}" 
                 data-decimals="${token.decimals}">

          <div class="h-10 w-10 flex-shrink-0">
            ${tokenLogo ? 
              `<img class="rounded-full" alt="${tokenName} logo" width="40" height="40" src="${tokenLogo}" style="aspect-ratio: 40 / 40; object-fit: cover;">` : 
              `<div class="h-10 w-10 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] flex items-center justify-center font-bold text-[var(--text-secondary)]">?</div>`}
          </div>
          
          <div class="flex-1 min-w-0">
            <h4 class="font-semibold text-[var(--text-primary)] truncate" title="${tokenName}">${tokenName}</h4>
            <p class="text-sm text-[var(--text-secondary)]">${tokenSymbol}</p>
          </div>
        </div>
        
        <div class="flex flex-col items-end flex-shrink-0 ml-4">
          <p class="text-sm font-medium text-[var(--text-primary)]">${token.amount / Math.pow(10, token.decimals)}</p>
        </div>
      </div>
    `;
    tokenList.appendChild(tokenItem);
  }
}

function displayExcludedTokens(nfts, frozenTokens) {
  const excludedList = document.getElementById('excluded-list');
  excludedList.innerHTML = ''; 

  if (nfts.length > 0) {
    const nftSection = document.createElement('div');
    // --- UI UPDATE ---
    nftSection.innerHTML = '<h3 class="text-lg font-semibold text-[var(--text-primary)] mb-2">NFTs</h3>';
    const nftList = document.createElement('ul');
    nftList.className = 'space-y-2';
    nfts.forEach(nft => {
      const nftItem = document.createElement('li');
      nftItem.className = "text-sm p-2 bg-[var(--bg-primary)] rounded-md border border-[var(--border-color)]"
      nftItem.innerHTML = `NFT (Mint: ${nft.mint.slice(0, 4)}...${nft.mint.slice(-4)})`;
      nftList.appendChild(nftItem);
    });
    nftSection.appendChild(nftList);
    excludedList.appendChild(nftSection);
  }

  if (frozenTokens.length > 0) {
    const frozenSection = document.createElement('div');
    // --- UI UPDATE ---
    frozenSection.innerHTML = '<h3 class="text-lg font-semibold text-[var(--text-primary)] mt-4 mb-2">Frozen Tokens</h3>';
    const frozenList = document.createElement('ul');
    frozenList.className = 'space-y-2';
    frozenTokens.forEach(token => {
      const frozenItem = document.createElement('li');
      frozenItem.className = "text-sm p-2 bg-[var(--bg-primary)] rounded-md border border-[var(--border-color)]"
      frozenItem.innerHTML = `Frozen (Mint: ${token.mint.slice(0, 4)}...${token.mint.slice(-4)}, Amount: ${token.amount / Math.pow(10, token.decimals)})`;
      frozenList.appendChild(frozenItem);
    });
    frozenSection.appendChild(frozenList);
    excludedList.appendChild(frozenSection);
  }

  if (nfts.length === 0 && frozenTokens.length === 0) {
      excludedList.innerHTML = '<p class="p-4 text-center">No excluded accounts (NFTs or Frozen) found.</p>';
  }
}

// --- UI Interaction Functions ---

function setDestinationAddress(address) {
  try {
    destinationAddress = new PublicKey(address);
    console.log('Destination address set:', destinationAddress.toString());

    const desAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
    
    // --- UI UPDATE --- (New "Change" button style)
    document.getElementById('des_Address_display_container').innerHTML = `
      <div class="flex gap-2 items-center justify-between w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2.5 rounded-lg h-[42px]">
        <span class="text-[var(--text-secondary)] text-sm">Dest: <span class="text-[var(--text-primary)] font-medium">${desAddress}</span></span>
        <button type="button" id="change-destination" 
          class="border border-[var(--accent)] text-[var(--accent)] font-semibold py-1 px-3 rounded-md text-sm transition-colors duration-150 hover:bg-[var(--accent)] hover:text-black">
          Change
        </button>
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

    // --- UI UPDATE --- (New "Change" button style)
    document.getElementById('fee_payer_display_container').innerHTML = `
      <div class="flex gap-2 items-center justify-between w-full bg-[var(--bg-primary)] border border-[var(--border-color)] p-2.5 rounded-lg h-[42px]">
        <span class="text-[var(--text-secondary)] text-sm">Fee: <span class="text-[var(--text-primary)] font-medium">${feepayerAddress}</span></span>
        <button type="button" id="change-fee-payer" 
          class="border border-[var(--accent)] text-[var(--accent)] font-semibold py-1 px-3 rounded-md text-sm transition-colors duration-150 hover:bg-[var(--accent)] hover:text-black">
          Change
        </button>
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
    // --- UI UPDATE --- (Using new CSS variables for color)
    statusEl.className = isError ? 
      'text-[var(--error)] font-medium p-2 rounded-md h-10 transition-colors duration-200 text-center text-sm' : 
      'text-[var(--accent)] font-medium p-2 rounded-md h-10 transition-colors duration-200 text-center text-sm';
}

// --- Transaction Logic (Unchanged) ---

async function burnAndCloseTokensInBatches() {
  if (!walletPublicKey) {
    updateStatus('Please connect your wallet first.', true);
    return;
  }

  const destination = destinationAddress ? destinationAddress : walletPublicKey;
  const feePayer = feePayerKeypair ? feePayerKeypair.publicKey : walletPublicKey;

  console.log('Using Destination:', destination.toString());
  console.log('Using Fee Payer:', feePayer.toString());

  const selectedCheckboxes = document.querySelectorAll('#token-list .token-checkbox:checked');
  if (selectedCheckboxes.length === 0) {
      updateStatus('No tokens selected to burn.', true);
      return;
  }

  updateStatus(`Preparing ${selectedCheckboxes.length} token accounts...`);

  const instructionsPerTx = 5; 
  const rpsLimit = 35; 
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
      const amountToBurn = BigInt(amount); 

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

      currentTransaction.add(createCloseAccountInstruction(
        tokenATA,
        destination, 
        walletPublicKey 
      ));
      instructionCount++;

      if (instructionCount >= instructionsPerTx) {
        transactionBatches.push(currentTransaction);
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
      continue; 
    }

    if (feePayerKeypair) {
      console.log('Partially signing with fee payer keypair...');
      try {
        for (const tx of signedTransactions) {
            tx.partialSign(feePayerKeypair);
        }
      } catch (err) {
          console.error('Error signing with fee payer keypair:', err);
          updateStatus('Fee payer signing failed.', true);
          continue; 
      }
    }
    
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

    if (i + batchSize < transactionBatches.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
  }

  if (successCount > 0) {
      updateStatus(`Process finished: ${successCount} tx(s) successful, ${errorCount} failed.`, errorCount > 0);
      await fetchAndDisplayATATokens();
  } else {
      updateStatus(`Process failed: ${errorCount} error(s).`, true);
  }
}

// --- Event Listeners (Unchanged) ---

document.addEventListener('click', (event) => {
    // Find the closest ancestor with an ID, in case the user clicks an icon/text inside a button
    const target = event.target.closest('[id]');
    if (!target) return;

    if (target.id === 'connect-wallet') {
        connectWallet();
    }
    
    if (target.id === 'burn-close-btn') {
        burnAndCloseTokensInBatches();
    }

    if (target.id === 'change-fee-payer') {
        feePayerKeypair = null; 
        document.getElementById('fee_payer_display_container').style.display = 'none';
        document.getElementById('fee_payer_input_container').style.display = 'block';
        document.getElementById('fee-payer-key').value = ''; 
        console.log('Fee payer cleared.');
    }

    if (target.id === 'change-destination') {
        destinationAddress = null; 
        document.getElementById('des_Address_display_container').style.display = 'none';
        document.getElementById('des_Address_input_container').style.display = 'block';
        document.getElementById('destination-address').value = ''; 
        console.log('Destination address cleared.');
    }
});

document.addEventListener('change', (event) => {
    if (event.target.id === 'destination-address') {
        setDestinationAddress(event.target.value);
    }

    if (event.target.id === 'fee-payer-key') {
        setFeePayer(event.target.value);
    }

    if (event.target.id === 'select-all-checkbox') {
        const isChecked = event.target.checked;
        document.querySelectorAll('.token-checkbox').forEach(checkbox => {
            checkbox.checked = isChecked;
        });
    }
});

window.onload = () => {
    connectWallet(true); // true for eager/trusted connect
};
