export const ECDSA_SIGNER_CONTRACT =
    "0x6A6F069E2a08c2468e7724Ab3250CdBFBA14D4FF"
export const WEBAUTHN_SIGNER_CONTRACT =
    "0x8AA55d4BfAE101609078681A69B5bc3181516612"
export const CALL_POLICY_CONTRACT = "0xe4Fec84B7B002273ecC86baa65a831ddB92d30a8"
export const GAS_POLICY_CONTRACT = "0xaeFC5AbC67FfD258abD0A3E54f65E70326F84b23"
export const RATE_LIMIT_POLICY_CONTRACT =
    "0xf63d4139B25c836334edD76641356c6b74C86873"
export const SIGNATURE_POLICY_CONTRACT =
    "0xF6A936c88D97E6fad13b98d2FD731Ff17eeD591d"
export const SUDO_POLICY_CONTRACT = "0x67b436caD8a6D025DF6C82C5BB43fbF11fC5B9B7"
export const TIMESTAMP_POLICY_CONTRACT =
    "0xB9f8f524bE6EcD8C945b1b87f9ae5C192FdCE20F"

export enum PolicyFlags {
    FOR_ALL_VALIDATION = "0x0000",
    NOT_FOR_VALIDATE_USEROP = "0x0001",
    NOT_FOR_VALIDATE_SIG = "0x0002"
}