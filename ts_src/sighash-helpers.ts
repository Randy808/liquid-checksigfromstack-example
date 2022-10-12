import {
    networks,
    issuance,
    Transaction,
    address,
    TxInput as Input,
} from "liquidjs-lib";
import { BufferWriter, varSliceSize } from "./bufferutils";
import { crypto } from "liquidjs-lib";

const SIGHASH_INPUT_MASK = 31; //0x1f
const ZERO: Buffer = Buffer.from(
    "0000000000000000000000000000000000000000000000000000000000000000",
    "hex"
);

function getIssuanceSize(txIn: Input): number {
    if (txIn.issuance) {
        return (
            txIn.issuance.assetBlindingNonce.length +
            txIn.issuance.assetEntropy.length +
            txIn.issuance.assetAmount.length +
            txIn.issuance.tokenAmount.length
        );
    }
    return 0;
}

export function hashForWitnessV0(
    tx: any,
    inIndex: number,
    hashType: number,
    includeOutputs: boolean = false,
    includeInputs: boolean = false,
    prevOutScript: Buffer = Buffer.from("0"),
    inputValue: Buffer = Buffer.from("0")
): Buffer {
    let hashOutputs = ZERO;
    let hashPrevouts = ZERO;
    let hashSequence = ZERO;
    let hashIssuances = ZERO;

    if (includeInputs) {
        const input = tx.ins[inIndex];
        const hasIssuance = input.issuance !== undefined;
        // Inputs
        if (!(hashType & Transaction.SIGHASH_ANYONECANPAY)) {
            const prevoutsHashWriter = BufferWriter.withCapacity(
                (32 + 4) * tx.ins.length
            );
            tx.ins.forEach((txIn) => {
                prevoutsHashWriter.writeSlice(txIn.hash);
                prevoutsHashWriter.writeUInt32(txIn.index);
            });

            hashPrevouts = crypto.hash256(prevoutsHashWriter.end());
        }

        // Sequences
        if (
            !(hashType & Transaction.SIGHASH_ANYONECANPAY) &&
            (hashType & SIGHASH_INPUT_MASK) !== Transaction.SIGHASH_SINGLE &&
            (hashType & SIGHASH_INPUT_MASK) !== Transaction.SIGHASH_NONE
        ) {
            const sequenceHashWriter = BufferWriter.withCapacity(
                4 * tx.ins.length
            );
            tx.ins.forEach((txIn) => {
                sequenceHashWriter.writeUInt32(txIn.sequence);
            });

            hashSequence = crypto.hash256(sequenceHashWriter.end());
        }

        // Issuances
        if (!(hashType & Transaction.SIGHASH_ANYONECANPAY)) {
            const sizeOfIssuances = this.ins.reduce(
                (sum, txIn) =>
                    txIn.issuance ? sum + getIssuanceSize(txIn) : sum + 1,
                0
            );
            const size =
                sizeOfIssuances === 0 ? this.ins.length : sizeOfIssuances;
            const issuancesHashWriter = BufferWriter.withCapacity(size);
            tx.ins.forEach((txIn: Input) => {
                if (txIn.issuance) {
                    issuancesHashWriter.writeSlice(
                        txIn.issuance!.assetBlindingNonce
                    );
                    issuancesHashWriter.writeSlice(txIn.issuance!.assetEntropy);
                    issuancesHashWriter.writeSlice(txIn.issuance!.assetAmount);
                    issuancesHashWriter.writeSlice(txIn.issuance!.tokenAmount);
                } else {
                    issuancesHashWriter.writeSlice(Buffer.of(0x00));
                }
            });

            hashIssuances = crypto.hash256(issuancesHashWriter.end());
        }

        const bufferSize =
            4 + // version
            hashPrevouts.length +
            hashSequence.length +
            hashIssuances.length +
            input.hash.length +
            4 + // input.index
            varSliceSize(prevOutScript) +
            inputValue.length +
            4 + // input.sequence
            getIssuanceSize(input);

        const inputSigWriter = BufferWriter.withCapacity(bufferSize);

        inputSigWriter.writeUInt32(tx.version);
        inputSigWriter.writeSlice(hashPrevouts);
        inputSigWriter.writeSlice(hashSequence);
        inputSigWriter.writeSlice(hashIssuances);
        inputSigWriter.writeSlice(input.hash);
        inputSigWriter.writeUInt32(input.index);
        inputSigWriter.writeVarSlice(prevOutScript);
        inputSigWriter.writeSlice(inputValue);
        inputSigWriter.writeUInt32(input.sequence);
        if (hasIssuance) {
            inputSigWriter.writeSlice(input.issuance!.assetBlindingNonce);
            inputSigWriter.writeSlice(input.issuance!.assetEntropy);
            inputSigWriter.writeSlice(input.issuance!.assetAmount);
            inputSigWriter.writeSlice(input.issuance!.tokenAmount);
        }

        return inputSigWriter.end();
    }

    if (includeOutputs) {
        // Outputs
        if (
            (hashType & SIGHASH_INPUT_MASK) !== Transaction.SIGHASH_SINGLE &&
            (hashType & SIGHASH_INPUT_MASK) !== Transaction.SIGHASH_NONE
        ) {
            const txOutsSize = tx.outs.reduce(
                (sum, output) =>
                    sum +
                    output.asset.length +
                    output.value.length +
                    output.nonce.length +
                    varSliceSize(output.script),
                0
            );
            const outputsHashWriter = BufferWriter.withCapacity(txOutsSize);
            tx.outs.forEach((out) => {
                outputsHashWriter.writeSlice(out.asset);
                outputsHashWriter.writeSlice(out.value);
                outputsHashWriter.writeSlice(out.nonce);
                outputsHashWriter.writeVarSlice(out.script);
            });
            hashOutputs = crypto.hash256(outputsHashWriter.end());
        } else if (
            (hashType & SIGHASH_INPUT_MASK) === Transaction.SIGHASH_SINGLE &&
            inIndex < tx.outs.length
        ) {
            const output = tx.outs[inIndex];
            const size =
                output.asset.length +
                output.value.length +
                output.nonce.length +
                varSliceSize(output.script);
            const outputsHashWriter = BufferWriter.withCapacity(size);
            outputsHashWriter.writeSlice(output.asset);
            outputsHashWriter.writeSlice(output.value);
            outputsHashWriter.writeSlice(output.nonce);
            outputsHashWriter.writeVarSlice(output.script);
            hashOutputs = crypto.hash256(outputsHashWriter.end());
        }

        const bufferSize =
            hashOutputs.length +
            4 + // locktime
            4; // hashType

        const outputSigWriter = BufferWriter.withCapacity(bufferSize);

        outputSigWriter.writeSlice(hashOutputs);
        outputSigWriter.writeUInt32(tx.locktime);
        outputSigWriter.writeUInt32(hashType);

        return outputSigWriter.end();
    }

    return Buffer.from("0");
}
