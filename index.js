const Web3 = require('web3');
const axios = require('axios')

const { ownerPrivateKey, userPrivateKey, providerURL, nodeURL } = require("./secrets.json")
const { contractAddress, abi, chainId, maxScanBlockCountForEvents, maxScanBlockCountForFee } = require("./config.json")
const { logEvent, syncNonceForAccount, readInfo, saveInfo } = require('./utils.js')

const web3 = new Web3(providerURL)

const processEvents = async () => {
  const info = readInfo()
  const fromBlock = info.lastBlockForEvents + 1
  const lastBlock = await web3.eth.getBlockNumber()

  const toBlock = Math.min(fromBlock+maxScanBlockCountForEvents-1, lastBlock)

  if (fromBlock > toBlock) {
    return true
  }

  console.log(`Scanning block ${fromBlock} ~ ${toBlock} for Events...`)

  const contract = new web3.eth.Contract(abi, contractAddress)
  const options = {
    filter: {},
    fromBlock: fromBlock,
    toBlock: toBlock
  }

  const events = await contract.getPastEvents("allEvents", options)

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    logEvent(event);
  }

  saveInfo({...info, lastBlockForEvents: toBlock})
  console.log("Scanning for Events finished")
  return false
}

const distributeT1Reward = async () => {

  console.log("Calling distributeT1Reward")

  const account = web3.eth.accounts.privateKeyToAccount(userPrivateKey)
  const contract = new web3.eth.Contract(abi, contractAddress)
  const transaction = contract.methods.distributeT1Reward()
  const encodedABI = transaction.encodeABI()
  const estimatedGas = await transaction.estimateGas({from: account.address})
  const gasPrice = await web3.eth.getGasPrice()

  const options = {
    chainId: chainId.toString(),
    to: transaction._parent._address,
    gas: estimatedGas*2,
    gasPrice: gasPrice*2,
    data: encodedABI
  }

  const signed = await web3.eth.accounts.signTransaction(options, userPrivateKey)

  try {
    await web3.eth.sendSignedTransaction(signed.rawTransaction)
  }
  catch (error) {
    console.log(`distributeT1Reward error: " + ${error}`)
  }
}

const processT1Reward = async () => {
  // check if there is any T1 licensor to reard
  const contract = new web3.eth.Contract(abi, contractAddress)
  let result = await contract.methods.shouldDistributeT1Reward().call();
  if (result == false) {
    console.log("No T1 Licensor to reward. Skipping...")
    return
  }

  // call distributeT1Reward if there is any
  await distributeT1Reward()
}

const getBlockFeeReward = async (blockNo) => {
  let txFeeHex = 0
  try {
    axios.defaults.baseURL = nodeURL
    const payload = {
      "jsonrpc": "2.0",
      "method": "eth_getMinerDataByBlockNumber",
      "params": [`${blockNo}`],
      "id": 1
    }
    let res = await axios.post("/", payload)
    txFeeHex = res.data.result.transactionFee
    let txFee = web3.utils.hexToNumber(txFeeHex, true)
    return txFee
  } catch (error) {
    console.log("getBlockReward error: ", error)
    console.log({blockNo, txFeeHex})
    return 0
  }
}

const distributeT2Reward = async (rewardFeeArray, lastBlockNo) => {
  console.log("Calling distributeT2Reward...")
  let blockNos = []
  let blockFees = []
  for (let i = 0; i < rewardFeeArray.length; i++) {
    blockNos.push(rewardFeeArray[i].blockNo)
    blockFees.push(rewardFeeArray[i].blockFee)
  }

  console.log({blockNos})
  console.log({blockFees})
  console.log({lastBlockNo})

  const account = web3.eth.accounts.privateKeyToAccount(ownerPrivateKey)
  const contract = new web3.eth.Contract(abi, contractAddress)
  const transaction = contract.methods.distributeT2Reward(blockNos, blockFees, lastBlockNo)
  const encodedABI = transaction.encodeABI()
  const estimatedGas = await transaction.estimateGas({from: account.address})
  const gasPrice = await web3.eth.getGasPrice()

  const options = {
    chainId: chainId.toString(),
    to: transaction._parent._address,
    gas: estimatedGas * 2,
    gasPrice: gasPrice*2,
    data: encodedABI
  }

  const signed = await web3.eth.accounts.signTransaction(options, ownerPrivateKey)

  try {
    await web3.eth.sendSignedTransaction(signed.rawTransaction)
    return true
  }
  catch (error) {
    console.log(`distributeT2Reward error: " + ${error}`)
    return false
  }
}

const processT2Reward = async () => {
  try {
    const info = readInfo()
    const fromBlock = info.lastBlockForFee + 1
    const lastBlock = await web3.eth.getBlockNumber()
    const toBlock = Math.min(fromBlock+maxScanBlockCountForFee-1, lastBlock)

    if (fromBlock > toBlock) {
      return true
    }

    // check if there T2 licensors
    // if there is no one we don't need to do it
    const contract = new web3.eth.Contract(abi, contractAddress)
    let result = await contract.methods.t2LicenseCount().call();
    if (result == 0) {
      console.log("No T2 Licensor. Skipping...")
      saveInfo({...info, lastBlockForFee: toBlock})
      return true
    }

    console.log(`Scanning block ${fromBlock} ~ ${toBlock} for Fee Rewards...`)

    let blockFeeArray = []
    for (let blockNo = fromBlock; blockNo <= toBlock; blockNo++) {
      let blockFee = await getBlockFeeReward(blockNo)
      let blockFeeReward = {blockNo, blockFee}
      blockFeeArray.push(blockFeeReward)
    }

    // distribute T2 rewards
    if (blockFeeArray.length == 0) {
      return false;
    }

    let distributed = await distributeT2Reward(blockFeeArray, toBlock)
    if (distributed == false) {
      return false;
    }

    saveInfo({...info, lastBlockForFee: toBlock})
    console.log("Scanning for Fee Rewards finished")

    if (fromBlock >= toBlock-1) {
      return true
    }
    else {
      return false
    }
  } catch (err) {
    console.log("Scanning for Fee Rewards error:", err)
    return false
  }
}

const processBurnSurplusCoins = async () => {
  let date = new Date()
  let hours = date.getHours()
  let mins = date.getMinutes()

  if (hours < 23 || mins < 30) {
    return;
  }

  const contract = new web3.eth.Contract(abi, contractAddress)
  let result = await contract.methods.shouldBurnSurplusCoins().call()
  if (result == false) {
    return;
  }

  console.log(`Calling processBurnSurplusCoins...`)

  const account = web3.eth.accounts.privateKeyToAccount(userPrivateKey)
  const transaction = contract.methods.burnSurplusCoins()
  const encodedABI = transaction.encodeABI()
  const estimatedGas = await transaction.estimateGas({from: account.address})
  const gasPrice = await web3.eth.getGasPrice()

  const options = {
    chainId: chainId.toString(),
    to: transaction._parent._address,
    gas: estimatedGas*2,
    gasPrice: gasPrice*2,
    data: encodedABI
  }

  const signed = await web3.eth.accounts.signTransaction(options, userPrivateKey)

  try {
    await web3.eth.sendSignedTransaction(signed.rawTransaction)
    return true
  }
  catch (error) {
    console.log(`processBurnSurplusCoins error: " + ${error}`)
    return false
  }
}

async function init() {
  console.log("Starting app...")
}

async function main() {
  // scan license purchase
  let scannedToEnd = false
  while (scannedToEnd == false) {
     scannedToEnd = await processEvents()
  }

  // reward distribution for T1 licensors
  await processT1Reward()

  // reward distribution for T2 licensors
  // scannedToEnd = false
  // while (scannedToEnd == false) {
  //   scannedToEnd = await processT2Reward()
  // }

  // process surplus coin burning
  await processBurnSurplusCoins()

  setTimeout(async () => {
    await main()
  }, 10000)
}

init()
  .then(async () => {
    await main()
  })