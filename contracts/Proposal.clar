(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-PROPOSAL-NOT-FOUND u101)
(define-constant ERR-ALREADY-VOTED u102)
(define-constant ERR-VOTING-ENDED u103)
(define-constant ERR-PROPOSAL-EXECUTED u104)
(define-constant ERR-QUORUM-NOT-REACHED u105)
(define-constant ERR-PROPOSAL-ACTIVE u106)
(define-constant ERR-INVALID-TYPE u107)
(define-constant ERR-INVALID-TARGET u108)
(define-constant ERR-INVALID-VALUE u109)
(define-constant ERR-INVALID-DURATION u110)
(define-constant ERR-DESCRIPTION-TOO-LONG u111)
(define-constant ERR-TITLE-TOO-LONG u112)

(define-data-var next-proposal-id uint u0)
(define-data-var executor-principal principal tx-sender)

(define-map proposals uint {
    id: uint,
    proposer: principal,
    title: (string-ascii 80),
    description: (string-utf8 2000),
    proposal-type: (string-ascii 50),
    target-contract: principal,
    target-function: (string-ascii 50),
    target-value: uint,
    start-block: uint,
    end-block: uint,
    yes-votes: uint,
    no-votes: uint,
    executed: bool,
    passed: bool
})

(define-map votes {proposal-id: uint, voter: principal} {
    vote: bool,
    weight: uint
})

(define-read-only (get-proposal (id uint))
    (map-get? proposals id)
)

(define-read-only (get-vote (proposal-id uint) (voter principal))
    (map-get? votes {proposal-id: proposal-id, voter: voter})
)

(define-read-only (is-executor (who principal))
    (is-eq who (var-get executor-principal))
)

(define-public (set-executor (new-executor principal))
    (begin
        (asserts! (is-executor tx-sender) (err ERR-UNAUTHORIZED))
        (var-set executor-principal new-executor)
        (ok true)
    )
)

(define-public (create-proposal
    (title (string-ascii 80))
    (description (string-utf8 2000))
    (proposal-type (string-ascii 50))
    (target-contract principal)
    (target-function (string-ascii 50))
    (target-value uint)
    (duration-blocks uint)
)
    (let (
        (proposal-id (var-get next-proposal-id))
        (start (+ block-height u1))
        (end (+ block-height u1 duration-blocks))
    )
        (asserts! (> (len title) u0) (err ERR-TITLE-TOO-LONG))
        (asserts! (<= (len title) u80) (err ERR-TITLE-TOO-LONG))
        (asserts! (<= (len description) u2000) (err ERR-DESCRIPTION-TOO-LONG))
        (asserts! (or
            (is-eq proposal-type "treasury-spend")
            (is-eq proposal-type "add-asset")
            (is-eq proposal-type "upgrade-rule")
            (is-eq proposal-type "emergency-pause")
        ) (err ERR-INVALID-TYPE))
        (asserts! (> duration-blocks u100) (err ERR-INVALID-DURATION))
        (asserts! (<= duration-blocks u10000) (err ERR-INVALID-DURATION))
        (map-set proposals proposal-id {
            id: proposal-id,
            proposer: tx-sender,
            title: title,
            description: description,
            proposal-type: proposal-type,
            target-contract: target-contract,
            target-function: target-function,
            target-value: target-value,
            start-block: start,
            end-block: end,
            yes-votes: u0,
            no-votes: u0,
            executed: false,
            passed: false
        })
        (var-set next-proposal-id (+ proposal-id u1))
        (print {event: "proposal-created", id: proposal-id, proposer: tx-sender})
        (ok proposal-id)
    )
)

(define-public (vote-on-proposal (proposal-id uint) (vote-yes bool) (weight uint))
    (let (
        (proposal (unwrap! (map-get? proposals proposal-id) (err ERR-PROPOSAL-NOT-FOUND)))
        (existing-vote (map-get? votes {proposal-id: proposal-id, voter: tx-sender}))
    )
        (asserts! (>= block-height (get start-block proposal)) (err ERR-VOTING-ENDED))
        (asserts! (< block-height (get end-block proposal)) (err ERR-VOTING-ENDED))
        (asserts! (not (get executed proposal)) (err ERR-PROPOSAL-EXECUTED))
        (asserts! (is-none existing-vote) (err ERR-ALREADY-VOTED))
        (asserts! (> weight u0) (err ERR-INVALID-VALUE))
        (map-set votes {proposal-id: proposal-id, voter: tx-sender} {
            vote: vote-yes,
            weight: weight
        })
        (map-set proposals proposal-id
            (if vote-yes
                (merge proposal {yes-votes: (+ (get yes-votes proposal) weight)})
                (merge proposal {no-votes: (+ (get no-votes proposal) weight)})
            )
        )
        (print {event: "vote-cast", proposal-id: proposal-id, voter: tx-sender, yes: vote-yes, weight: weight})
        (ok true)
    )
)

(define-public (execute-proposal (proposal-id uint))
    (let (
        (proposal (unwrap! (map-get? proposals proposal-id) (err ERR-PROPOSAL-NOT-FOUND)))
        (total-votes (+ (get yes-votes proposal) (get no-votes proposal)))
        (quorum-required (/ total-votes u4))
    )
        (asserts! (is-executor tx-sender) (err ERR-UNAUTHORIZED))
        (asserts! (>= block-height (get end-block proposal)) (err ERR-PROPOSAL-ACTIVE))
        (asserts! (not (get executed proposal)) (err ERR-PROPOSAL-EXECUTED))
        (asserts! (>= (get yes-votes proposal) quorum-required) (err ERR-QUORUM-NOT-REACHED))
        (map-set proposals proposal-id (merge proposal {
            executed: true,
            passed: true
        }))
        (print {event: "proposal-executed", id: proposal-id, passed: true})
        (ok true)
    )
)

(define-public (emergency-cancel (proposal-id uint))
    (let ((proposal (unwrap! (map-get? proposals proposal-id) (err ERR-PROPOSAL-NOT-FOUND))))
        (asserts! (is-executor tx-sender) (err ERR-UNAUTHORIZED))
        (asserts! (not (get executed proposal)) (err ERR-PROPOSAL-EXECUTED))
        (map-set proposals proposal-id (merge proposal {executed: true, passed: false}))
        (print {event: "proposal-cancelled", id: proposal-id})
        (ok true)
    )
)

(define-read-only (get-next-proposal-id)
    (ok (var-get next-proposal-id))
)

(define-read-only (has-voted (proposal-id uint) (voter principal))
    (is-some (map-get? votes {proposal-id: proposal-id, voter: voter}))
)