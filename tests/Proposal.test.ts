import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityValue, uintCV, boolCV, stringAsciiCV, stringUtf8CV, someCV, noneCV } from "@stacks/transactions";

interface Proposal {
  id: bigint;
  proposer: string;
  title: string;
  description: string;
  proposalType: string;
  targetContract: string;
  targetFunction: string;
  targetValue: bigint;
  startBlock: bigint;
  endBlock: bigint;
  yesVotes: bigint;
  noVotes: bigint;
  executed: boolean;
  passed: boolean;
}

interface Vote {
  vote: boolean;
  weight: bigint;
}

const ERR_UNAUTHORIZED = 100n;
const ERR_PROPOSAL_NOT_FOUND = 101n;
const ERR_ALREADY_VOTED = 102n;
const ERR_VOTING_ENDED = 103n;
const ERR_PROPOSAL_EXECUTED = 104n;
const ERR_QUORUM_NOT_REACHED = 105n;

class ProposalCoreMock {
  state: {
    nextProposalId: bigint;
    executor: string;
    proposals: Map<bigint, Proposal>;
    votes: Map<string, Vote>;
  } = {
    nextProposalId: 0n,
    executor: "ST1EXECUTOR",
    proposals: new Map(),
    votes: new Map(),
  };

  blockHeight = 1000n;
  caller = "ST1PROPOSER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextProposalId: 0n,
      executor: "ST1EXECUTOR",
      proposals: new Map(),
      votes: new Map(),
    };
    this.blockHeight = 1000n;
    this.caller = "ST1PROPOSER";
  }

  setExecutor(newExecutor: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.executor) return { ok: false, value: false };
    this.state.executor = newExecutor;
    return { ok: true, value: true };
  }

  createProposal(
    title: string,
    description: string,
    proposalType: string,
    targetContract: string,
    targetFunction: string,
    targetValue: bigint,
    durationBlocks: bigint
  ): { ok: boolean; value: bigint } {
    if (title.length === 0 || title.length > 80) return { ok: false, value: 112n };
    if (description.length > 2000) return { ok: false, value: 111n };
    if (!["treasury-spend", "add-asset", "upgrade-rule", "emergency-pause"].includes(proposalType))
      return { ok: false, value: 107n };
    if (durationBlocks <= 100n || durationBlocks > 10000n) return { ok: false, value: 110n };

    const id = this.state.nextProposalId;
    const start = this.blockHeight + 1n;
    const end = this.blockHeight + 1n + durationBlocks;

    this.state.proposals.set(id, {
      id,
      proposer: this.caller,
      title,
      description,
      proposalType,
      targetContract,
      targetFunction,
      targetValue,
      startBlock: start,
      endBlock: end,
      yesVotes: 0n,
      noVotes: 0n,
      executed: false,
      passed: false,
    });

    this.state.nextProposalId += 1n;
    return { ok: true, value: id };
  }

  voteOnProposal(proposalId: bigint, voteYes: boolean, weight: bigint): { ok: boolean; value: boolean } {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (this.blockHeight < proposal.startBlock || this.blockHeight >= proposal.endBlock)
      return { ok: false, value: ERR_VOTING_ENDED };
    if (proposal.executed) return { ok: false, value: ERR_PROPOSAL_EXECUTED };
    const key = `${proposalId}-${this.caller}`;
    if (this.state.votes.has(key)) return { ok: false, value: ERR_ALREADY_VOTED };
    if (weight === 0n) return { ok: false, value: 109n };

    this.state.votes.set(key, { vote: voteYes, weight });
    const updated = { ...proposal };
    if (voteYes) updated.yesVotes += weight;
    else updated.noVotes += weight;
    this.state.proposals.set(proposalId, updated);
    return { ok: true, value: true };
  }

  executeProposal(proposalId: bigint): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.executor) return { ok: false, value: false };
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) return { ok: false, value: ERR_PROPOSAL_NOT_FOUND };
    if (this.blockHeight < proposal.endBlock) return { ok: false, value: 106n };
    if (proposal.executed) return { ok: false, value: ERR_PROPOSAL_EXECUTED };

    const total = proposal.yesVotes + proposal.noVotes;
    const quorum = total / 4n;
    if (proposal.yesVotes < quorum) return { ok: false, value: ERR_QUORUM_NOT_REACHED };

    const updated = { ...proposal, executed: true, passed: true };
    this.state.proposals.set(proposalId, updated);
    return { ok: true, value: true };
  }

  getProposal(id: bigint): Proposal | null {
    return this.state.proposals.get(id) || null;
  }

  getNextProposalId(): { ok: boolean; value: bigint } {
    return { ok: true, value: this.state.nextProposalId };
  }
}

describe("Proposal.clar Core Governance", () => {
  let mock: ProposalCoreMock;

  beforeEach(() => {
    mock = new ProposalCoreMock();
    mock.reset();
  });

  it("creates valid proposal successfully", () => {
    const result = mock.createProposal(
      "Fund Solar Panel",
      "Install 50kW solar array in Zone A",
      "treasury-spend",
      "ST2TREASURY",
      "transfer",
      50000000n,
      2016n
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);
    const p = mock.getProposal(0n);
    expect(p?.title).toBe("Fund Solar Panel");
    expect(p?.proposalType).toBe("treasury-spend");
    expect(p?.targetValue).toBe(50000000n);
    expect(p?.startBlock).toBe(1001n);
    expect(p?.endBlock).toBe(3017n);
  });

  it("rejects invalid proposal types", () => {
    const result = mock.createProposal("Bad", "desc", "hack-system", "ST1", "run", 1n, 2016n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(107n);
  });

  it("rejects short or long duration", () => {
    let result = mock.createProposal("Test", "desc", "treasury-spend", "ST1", "f", 1n, 50n);
    expect(result.ok).toBe(false);
    result = mock.createProposal("Test", "desc", "treasury-spend", "ST1", "f", 1n, 20000n);
    expect(result.ok).toBe(false);
  });

  it("allows voting during voting period", () => {
    mock.createProposal("Vote me", "yes", "add-asset", "ST1", "add", 1n, 1000n);
    mock.blockHeight = 1050n;
    const result = mock.voteOnProposal(0n, true, 750n);
    expect(result.ok).toBe(true);
    const p = mock.getProposal(0n);
    expect(p?.yesVotes).toBe(750n);
  });

  it("prevents double voting", () => {
    mock.createProposal("Test", "desc", "treasury-spend", "ST1", "x", 1n, 1000n);
    mock.blockHeight = 1050n;
    mock.voteOnProposal(0n, true, 100n);
    const result = mock.voteOnProposal(0n, false, 50n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_VOTED);
  });

  it("executes proposal only after end and with quorum", () => {
    mock.createProposal("Quorum Test", "need 25%", "treasury-spend", "ST1", "pay", 1000n, 500n);
    mock.blockHeight = 1100n;
    mock.voteOnProposal(0n, true, 800n);
    mock.voteOnProposal(0n, false, 200n);
    mock.blockHeight = 1600n;
    mock.caller = "ST1EXECUTOR";
    const result = mock.executeProposal(0n);
    expect(result.ok).toBe(true);
    const p = mock.getProposal(0n);
    expect(p?.executed).toBe(true);
    expect(p?.passed).toBe(true);
  });

  it("only executor can execute", () => {
    mock.createProposal("Exec Only", "test", "treasury-spend", "ST1", "x", 1n, 200n);
    mock.blockHeight = 1500n;
    mock.caller = "ST1HACKER";
    const result = mock.executeProposal(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("executor can be changed", () => {
    mock.caller = "ST1EXECUTOR";
    const result = mock.setExecutor("ST2NEWEXEC");
    expect(result.ok).toBe(true);
    expect(mock.state.executor).toBe("ST2NEWEXEC");
  });

  it("tracks next proposal ID correctly", () => {
    mock.createProposal("P1", "d", "treasury-spend", "ST1", "x", 1n, 2016n);
    mock.createProposal("P2", "d", "add-asset", "ST1", "x", 1n, 2016n);
    const result = mock.getNextProposalId();
    expect(result.value).toBe(2n);
  });

  it("rejects empty or overly long title", () => {
    let result = mock.createProposal("", "desc", "treasury-spend", "ST1", "x", 1n, 2016n);
    expect(result.ok).toBe(false);
    const longTitle = "A".repeat(81);
    result = mock.createProposal(longTitle, "desc", "treasury-spend", "ST1", "x", 1n, 2016n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(112n);
  });
});