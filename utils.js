const fs = require('fs')
const Web3 = require('web3');

const { ownerPrivateKey, providerURL } = require("./secrets.json")

const web3 = new Web3(providerURL)

const defaultInfo = {
  // nonce: 0,
  lastBlockForEvents: -1
}

const saveInfo = (info) => {
  const data = JSON.stringify(info)
  try {
    fs.writeFileSync('info.dat', data)
  }
  catch (err) {
    console.log(`Error saving info file: ${err}`)
  }
}

const readInfo = () => {
  try {
    const data = fs.readFileSync('info.dat', 'utf-8')
    const info = JSON.parse(data)
    return info
  }
  catch (err) {
    console.log(`Error reading info file: ${err}`)
    return defaultInfo
  }
}

const syncNonceForAccount = async () => {
  console.log("synchronizing nonce...")
  try {
    const account = web3.eth.accounts.privateKeyToAccount(ownerPrivateKey)
    const nonce = await web3.eth.getTransactionCount(account.address)
    const info = readInfo()
    saveInfo({...info, nonce})
    console.log("synchronized. nonce is " + nonce)
    return nonce
  }
  catch (err) {
    console.log(err)
    return 0
  }
}

const checkAmountMatchLicenseFormat = (amountInWei) => {
  const amountInEther = web3.utils.fromWei(amountInWei, 'ether')
  const amountInEtherString = amountInEther.toString()

  const decimalIndex = amountInEtherString.indexOf('.')
  const decimalCount = decimalIndex == -1 ? 0 : amountInEtherString.length - decimalIndex - 1
  if (decimalCount !== 3) {
    return null
  }

  const decimalString = amountInEtherString.substring(decimalIndex+1, decimalIndex+decimalCount+1)
  if (decimalString === "001") {
    return "T1"
  }
  else if (decimalString == "003") {
    return "T2"
  }
  else {
    return null
  }
}

const logEvent = (event) => {
  let eventLog = {
    event: event.event,
    blockNumber: event.blockNumber,
    values: event.returnValues
  }
  console.log(eventLog)
}

module.exports = { saveInfo, readInfo, logEvent, syncNonceForAccount, checkAmountMatchLicenseFormat };