import { startAuthentication } from "@simplewebauthn/browser"
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/typescript-types"
import type { TypedData } from "abitype"
import { SignTransactionNotSupportedBySmartAccount } from "permissionless/accounts"
import {
    type Chain,
    type Client,
    type LocalAccount,
    type SignTypedDataParameters,
    type Transport,
    type TypedDataDefinition,
    getTypesForEIP712Domain,
    hashTypedData,
    maxUint256,
    validateTypedData
} from "viem"
import { type SignableMessage, encodeAbiParameters } from "viem"
import { toAccount } from "viem/accounts"
import { getChainId } from "viem/actions"
import { WEBAUTHN_SIGNER_CONTRACT } from "../constants.js"
import { WebAuthnMode, toWebAuthnPubKey } from "./toWebAuthnPubKey.js"
import type { ModularSigner, ModularSignerParams } from "./types.js"
import {
    b64ToBytes,
    findQuoteIndices,
    isRIP7212SupportedNetwork,
    parseAndNormalizeSig,
    uint8ArrayToHexString
} from "./webAuthnUtils.js"

export type WebAuthnKey = {
    pubX: bigint
    pubY: bigint
}

export type WebAuthnModularSignerParams = ModularSignerParams & {
    passkeyName: string
    passkeyServerUrl: string
    pubKey?: WebAuthnKey
    mode?: WebAuthnMode
}

export const toWebAuthnSigner = async <
    TTransport extends Transport = Transport,
    TChain extends Chain | undefined = Chain | undefined
>(
    client: Client<TTransport, TChain, undefined>,
    {
        signerContractAddress = WEBAUTHN_SIGNER_CONTRACT,
        pubKey,
        passkeyServerUrl,
        passkeyName,
        mode = WebAuthnMode.Register
    }: WebAuthnModularSignerParams
): Promise<ModularSigner> => {
    pubKey =
        pubKey ??
        (await toWebAuthnPubKey({
            passkeyName,
            passkeyServerUrl,
            mode
        }))
    if (!pubKey) {
        throw new Error("WebAuthn public key not found")
    }

    const chainId = await getChainId(client)

    const signMessageUsingWebAuthn = async (message: SignableMessage) => {
        let messageContent: string
        if (typeof message === "string") {
            // message is a string
            messageContent = message
        } else if ("raw" in message && typeof message.raw === "string") {
            // message.raw is a Hex string
            messageContent = message.raw
        } else if ("raw" in message && message.raw instanceof Uint8Array) {
            // message.raw is a ByteArray
            messageContent = message.raw.toString()
        } else {
            throw new Error("Unsupported message format")
        }

        // remove 0x prefix if present
        const formattedMessage = messageContent.startsWith("0x")
            ? messageContent.slice(2)
            : messageContent

        // initiate signing
        const signInitiateResponse = await fetch(
            `${passkeyServerUrl}/sign-initiate`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: formattedMessage }),
                credentials: "include"
            }
        )
        const signInitiateResult = await signInitiateResponse.json()

        // prepare assertion options
        const assertionOptions: PublicKeyCredentialRequestOptionsJSON = {
            challenge: signInitiateResult.challenge,
            allowCredentials: signInitiateResult.allowCredentials,
            userVerification: "required"
        }

        // start authentication (signing)
        const cred = await startAuthentication(assertionOptions)

        // verify signature from server
        const verifyResponse = await fetch(`${passkeyServerUrl}/sign-verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cred }),
            credentials: "include"
        })

        const verifyResult = await verifyResponse.json()

        if (!verifyResult.success) {
            throw new Error("Signature not verified")
        }

        // get authenticator data
        const authenticatorData = verifyResult.authenticatorData
        const authenticatorDataHex = uint8ArrayToHexString(
            b64ToBytes(authenticatorData)
        )

        // get client data JSON
        const clientDataJSON = atob(cred.response.clientDataJSON)

        // get challenge and response type location
        const { beforeType, beforeChallenge } = findQuoteIndices(clientDataJSON)

        // get signature r,s
        const signature = verifyResult.signature
        const signatureHex = uint8ArrayToHexString(b64ToBytes(signature))
        const { r, s } = parseAndNormalizeSig(signatureHex)

        // encode signature
        const encodedSignature = encodeAbiParameters(
            [
                { name: "authenticatorData", type: "bytes" },
                { name: "clientDataJSON", type: "string" },
                { name: "challengeLocation", type: "uint256" },
                { name: "responseTypeLocation", type: "uint256" },
                { name: "r", type: "uint256" },
                { name: "s", type: "uint256" },
                { name: "usePrecompiled", type: "bool" }
            ],
            [
                authenticatorDataHex,
                clientDataJSON,
                beforeChallenge,
                beforeType,
                BigInt(r),
                BigInt(s),
                isRIP7212SupportedNetwork(chainId)
            ]
        )
        return encodedSignature
    }
    const account: LocalAccount = toAccount({
        // note that this address will be overwritten by actual address
        address: "0x0000000000000000000000000000000000000000",
        async signMessage({ message }) {
            return signMessageUsingWebAuthn(message)
        },
        async signTransaction(_, __) {
            throw new SignTransactionNotSupportedBySmartAccount()
        },
        async signTypedData<
            const TTypedData extends TypedData | Record<string, unknown>,
            TPrimaryType extends
                | keyof TTypedData
                | "EIP712Domain" = keyof TTypedData
        >(typedData: TypedDataDefinition<TTypedData, TPrimaryType>) {
            const { domain, message, primaryType } =
                typedData as unknown as SignTypedDataParameters

            const types = {
                EIP712Domain: getTypesForEIP712Domain({ domain }),
                ...typedData.types
            }

            validateTypedData({ domain, message, primaryType, types })

            const hash = hashTypedData(typedData)
            return signMessageUsingWebAuthn(hash)
        }
    })

    return {
        account,
        signerContractAddress,
        getSignerData: () => {
            if (!pubKey) {
                throw new Error("WebAuthn public key not found")
            }
            return encodeAbiParameters(
                [
                    { name: "pubX", type: "uint256" },
                    { name: "pubY", type: "uint256" }
                ],
                [pubKey.pubX, pubKey.pubY]
            )
        },
        getDummySignature: () => {
            return encodeAbiParameters(
                [
                    { name: "authenticatorData", type: "bytes" },
                    { name: "clientDataJSON", type: "string" },
                    { name: "challengeLocation", type: "uint256" },
                    { name: "responseTypeLocation", type: "uint256" },
                    { name: "r", type: "uint256" },
                    { name: "s", type: "uint256" },
                    { name: "usePrecompiled", type: "bool" }
                ],
                [
                    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                    '{"type":"webauthn.get","challenge":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","origin":"https://example.com"}',
                    maxUint256,
                    maxUint256,
                    11111111111111111111111111111111111111111111111111111111111111111111111111111n,
                    22222222222222222222222222222222222222222222222222222222222222222222222222222n,
                    isRIP7212SupportedNetwork(chainId)
                ]
            )
        }
    }
}