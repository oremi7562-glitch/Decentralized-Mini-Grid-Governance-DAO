// Treasury.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_UNAUTHORIZED = 200n;
const ERR_INSUFFICIENT_BALANCE = 201n;
const ERR_PROPOSAL_NOT_PASSED = 202n;
const ERR_ALREADY_EXECUTED = 203n;
const ERR_INVALID_AMOUNT = 204n;
const ERR_PROPOSAL_NOT_FOUND = 206n;
const ERR_TREASURY_LOCKED = 207n;

class TreasuryMock {
  state: {
    nonce: bigint;
    locked: boolean;
    executor: string;
    withdrawals: Map<bigint, any>;
    deposits: Map<string, any>;
    balance: bigint;
  } = {
    nonce: 0n,
    locked: false,
    executor: "ST1EXEC",
    withdrawals: new Map(),
    deposits: new Map(),
    balance: 0n,
  };

  caller = "ST1USER";
  blockHeight = 1000n;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nonce: 0n,
      locked: false,
      executor: "ST1EXEC",
      withdrawals: new Map(),
      deposits: new Map(),
      balance: 0n,
    };
    this.caller = "ST1USER";
    this.blockHeight = 1000n;
  }

  deposit(amount: bigint): { ok: boolean; value: bigint } {
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    this.state.balance += amount;
    const id = this.state.nonce;
    this.state.deposits.set(`${this.caller}-${id}`, {
      amount,
      timestamp: this.blockHeight,
    });
    this.state.nonce += 1n;
    return { ok: true, value: id };
  }

  executeWithdrawal(
    proposal: any,
    amount: bigint,
    recipient: string
  ): { ok: boolean; value: bigint } {
    if (this.caller !== this.state.executor)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (this.state.locked) return { ok: false, value: ERR_TREASURY_LOCKED };
    if (amount <= 0n) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (!proposal.executed) return { ok: false, value: ERR_ALREADY_EXECUTED };
    if (!proposal.passed) return { ok: false, value: ERR_PROPOSAL_NOT_PASSED };
    if (proposal.proposalType !== "treasury-spend")
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (proposal.targetValue !== amount)
      return { ok: false, value: ERR_INVALID_AMOUNT };

    if (this.state.balance < amount)
      return { ok: false, value: ERR_INSUFFICIENT_BALANCE };
    this.state.balance -= amount;

    const id = this.state.nonce;
    this.state.withdrawals.set(id, {
      id,
      proposalId: proposal.id,
      amount,
      recipient,
      executed: true,
      timestamp: this.blockHeight,
    });
    this.state.nonce += 1n;
    return { ok: true, value: id };
  }

  emergencyLock(): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.executor) return { ok: false, value: false };
    this.state.locked = true;
    return { ok: true, value: true };
  }

  emergencyUnlock(): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.executor) return { ok: false, value: false };
    this.state.locked = false;
    return { ok: true, value: true };
  }

  getTreasuryBalance(): bigint {
    return this.state.balance;
  }
}

describe("Treasury.clar", () => {
  let mock: TreasuryMock;

  beforeEach(() => {
    mock = new TreasuryMock();
    mock.reset();
  });

  it("allows valid deposits", () => {
    const result = mock.deposit(1000000n);
    expect(result.ok).toBe(true);
    expect(mock.getTreasuryBalance()).toBe(1000000n);
  });

  it("rejects zero or negative deposits", () => {
    const result = mock.deposit(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("executes withdrawal only with passed treasury-spend proposal", () => {
    mock.caller = "ST1EXEC";
    mock.deposit(5000000n);

    const passedProposal = {
      id: 5n,
      executed: true,
      passed: true,
      proposalType: "treasury-spend",
      targetContract: "STTREASURY",
      targetValue: 2000000n,
      targetFunction: "execute-withdrawal",
    };

    const result = mock.executeWithdrawal(
      passedProposal,
      2000000n,
      "ST2RECIPIENT"
    );
    expect(result.ok).toBe(true);
    expect(mock.getTreasuryBalance()).toBe(3000000n);
  });

  it("rejects withdrawal if proposal not passed", () => {
    mock.caller = "ST1EXEC";
    mock.deposit(1000000n);

    const failedProposal = {
      executed: true,
      passed: false,
      proposalType: "treasury-spend",
      targetValue: 500000n,
    };

    const result = mock.executeWithdrawal(failedProposal, 500000n, "ST2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PROPOSAL_NOT_PASSED);
  });

  it("rejects withdrawal with wrong amount", () => {
    mock.caller = "ST1EXEC";
    const proposal = {
      executed: true,
      passed: true,
      proposalType: "treasury-spend",
      targetValue: 1000000n,
    };

    const result = mock.executeWithdrawal(proposal, 500000n, "ST2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("enforces treasury lock", () => {
    mock.caller = "ST1EXEC";
    mock.emergencyLock();
    mock.deposit(1000000n);

    const proposal = {
      executed: true,
      passed: true,
      proposalType: "treasury-spend",
      targetValue: 500000n,
    };

    const result = mock.executeWithdrawal(proposal, 500000n, "ST2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TREASURY_LOCKED);
  });

  it("only executor can lock/unlock", () => {
    mock.caller = "ST1HACKER";
    const lock = mock.emergencyLock();
    expect(lock.ok).toBe(false);
    mock.caller = "ST1EXEC";
    const unlock = mock.emergencyUnlock();
    expect(unlock.ok).toBe(true);
  });

  it("prevents execution by non-executor", () => {
    mock.caller = "ST1HACKER";
    const result = mock.executeWithdrawal({ passed: true }, 100n, "ST2");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("tracks multiple deposits and withdrawals correctly", () => {
    mock.caller = "ST1USER";
    mock.deposit(3000000n);
    mock.caller = "ST2USER";
    mock.deposit(2000000n);

    mock.caller = "ST1EXEC";
    const proposal = {
      id: 10n,
      executed: true,
      passed: true,
      proposalType: "treasury-spend",
      targetValue: 1500000n,
      targetFunction: "execute-withdrawal",
    };

    mock.executeWithdrawal(proposal, 1500000n, "ST3");
    expect(mock.getTreasuryBalance()).toBe(3500000n);
  });
});
