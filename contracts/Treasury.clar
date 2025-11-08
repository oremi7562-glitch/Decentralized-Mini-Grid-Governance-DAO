;; Treasury.clar

(define-constant ERR-UNAUTHORIZED u200)
(define-constant ERR-INSUFFICIENT-BALANCE u201)
(define-constant ERR-PROPOSAL-NOT-PASSED u202)
(define-constant ERR-ALREADY-EXECUTED u203)
(define-constant ERR-INVALID-AMOUNT u204)
(define-constant ERR-INVALID-RECIPIENT u205)
(define-constant ERR-PROPOSAL-NOT-FOUND u206)
(define-constant ERR-TREASURY-LOCKED u207)

(define-data-var treasury-nonce uint u0)
(define-data-var locked bool false)
(define-data-var executor principal (var-get executor-principal-from-proposal))

(define-map withdrawals uint {
    id: uint,
    proposal-id: uint,
    amount: uint,
    recipient: principal,
    executed: bool,
    timestamp: uint
})

(define-map deposits {depositor: principal, deposit-id: uint} {
    amount: uint,
    timestamp: uint
})

(define-read-only (get-treasury-balance)
    (ok (stx-get-balance (as-contract tx-sender)))
)

(define-read-only (get-withdrawal (id uint))
    (map-get? withdrawals id)
)

(define-read-only (is-locked)
    (ok (var-get locked))
)

(define-public (deposit (amount uint))
    (let (
        (deposit-id (var-get treasury-nonce))
        (depositor tx-sender)
    )
        (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
        (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
        (map-set deposits {depositor: depositor, deposit-id: deposit-id}
            {amount: amount, timestamp: block-height}
        )
        (var-set treasury-nonce (+ deposit-id u1))
        (print {event: "treasury-deposit", depositor: depositor, amount: amount, id: deposit-id})
        (ok deposit-id)
    )
)

(define-public (execute-withdrawal (proposal-id uint) (amount uint) (recipient principal))
    (let (
        (withdrawal-id (var-get treasury-nonce))
        (proposal (contract-call? .Proposal get-proposal proposal-id))
    )
        (asserts! (is-eq tx-sender (var-get executor)) (err ERR-UNAUTHORIZED))
        (asserts! (not (var-get locked)) (err ERR-TREASURY-LOCKED))
        (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
        (asserts! (is-some proposal) (err ERR-PROPOSAL-NOT-FOUND))
        (let ((p (unwrap! proposal (err ERR-PROPOSAL-NOT-FOUND))))
            (asserts! (get executed p) (err ERR-ALREADY-EXECUTED))
            (asserts! (get passed p) (err ERR-PROPOSAL-NOT-PASSED))
            (asserts! (is-eq (get proposal-type p) "treasury-spend") (err ERR-UNAUTHORIZED))
            (asserts! (is-eq (get target-contract p) (as-contract tx-sender)) (err ERR-UNAUTHORIZED))
            (asserts! (is-eq (get target-value p) amount) (err ERR-INVALID-AMOUNT))
            (asserts! (is-eq (get target-function p) "execute-withdrawal") (err ERR-UNAUTHORIZED))
        )
        (try! (as-contract (stx-transfer? amount tx-sender recipient)))
        (map-set withdrawals withdrawal-id
            {id: withdrawal-id, proposal-id: proposal-id, amount: amount, recipient: recipient, executed: true, timestamp: block-height}
        )
        (var-set treasury-nonce (+ withdrawal-id u1))
        (print {event: "treasury-withdrawal", id: withdrawal-id, amount: amount, recipient: recipient})
        (ok withdrawal-id)
    )
)

(define-public (emergency-lock)
    (begin
        (asserts! (is-eq tx-sender (var-get executor)) (err ERR-UNAUTHORIZED))
        (var-set locked true)
        (print {event: "treasury-locked", executor: tx-sender})
        (ok true)
    )
)

(define-public (emergency-unlock)
    (begin
        (asserts! (is-eq tx-sender (var-get executor)) (err ERR-UNAUTHORIZED))
        (var-set locked false)
        (print {event: "treasury-unlocked", executor: tx-sender})
        (ok true)
    )
)

(define-public (update-executor-from-proposal)
    (let ((proposal-contract .Proposal))
        (var-set executor (contract-call? proposal-contract executor-principal))
        (ok true)
    )
)