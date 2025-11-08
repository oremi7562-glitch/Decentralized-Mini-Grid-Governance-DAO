;; EnergyRegistry.clar

(define-constant ERR-UNAUTHORIZED u300)
(define-constant ERR-ASSET-EXISTS u301)
(define-constant ERR-ASSET-NOT-FOUND u302)
(define-constant ERR-INVALID-CAPACITY u303)
(define-constant ERR-INVALID-LOCATION u304)
(define-constant ERR-NOT-OWNER u305)
(define-constant ERR-ASSET-LOCKED u306)
(define-constant ERR-INVALID-METADATA u307)

(define-data-var asset-nonce uint u0)
(define-data-var registry-executor principal (var-get executor-principal-from-proposal))

(define-map energy-assets uint {
    id: uint,
    owner: principal,
    asset-type: (string-ascii 30),
    capacity-kw: uint,
    location: (string-utf8 120),
    metadata-hash: (buff 32),
    registered-at: uint,
    active: bool,
    locked: bool
})

(define-map assets-by-owner {owner: principal, asset-id: uint} bool)
(define-map assets-by-location (string-utf8 120) (list 100 uint))

(define-read-only (get-asset (id uint))
    (map-get? energy-assets id)
)

(define-read-only (get-assets-by-owner (owner principal))
    (map-get assets-by-owner {owner: owner, asset-id: u0})
)

(define-read-only (get-asset-list-by-location (location (string-utf8 120)))
    (map-get? assets-by-location location)
)

(define-public (register-asset
    (asset-type (string-ascii 30))
    (capacity-kw uint)
    (location (string-utf8 120))
    (metadata-hash (buff 32))
)
    (let (
        (asset-id (var-get asset-nonce))
    )
        (asserts! (or 
            (is-eq asset-type "solar")
            (is-eq asset-type "wind")
            (is-eq asset-type "hydro")
            (is-eq asset-type "battery")
            (is-eq asset-type "generator")
        ) (err ERR-INVALID-METADATA))
        (asserts! (> capacity-kw u0) (err ERR-INVALID-CAPACITY))
        (asserts! (<= (len location) u120) (err ERR-INVALID-LOCATION))
        (asserts! (is-eq (len metadata-hash) u32) (err ERR-INVALID-METADATA))
        
        (map-set energy-assets asset-id {
            id: asset-id,
            owner: tx-sender,
            asset-type: asset-type,
            capacity-kw: capacity-kw,
            location: location,
            metadata-hash: metadata-hash,
            registered-at: block-height,
            active: true,
            locked: false
        })
        (map-set assets-by-owner {owner: tx-sender, asset-id: asset-id} true)
        (map-set assets-by-location location 
            (unwrap! (as-max-len? (append (default-to (list ) (map-get? assets-by-location location)) asset-id) u100) (err ERR-INVALID-LOCATION))
        )
        (var-set asset-nonce (+ asset-id u1))
        (print {event: "asset-registered", id: asset-id, owner: tx-sender, type: asset-type})
        (ok asset-id)
    )
)

(define-public (update-asset-metadata (asset-id uint) (new-metadata-hash (buff 32)))
    (let ((asset (unwrap! (map-get? energy-assets asset-id) (err ERR-ASSET-NOT-FOUND))))
        (asserts! (is-eq (get owner asset) tx-sender) (err ERR-NOT-OWNER))
        (asserts! (not (get locked asset)) (err ERR-ASSET-LOCKED))
        (asserts! (is-eq (len new-metadata-hash) u32) (err ERR-INVALID-METADATA))
        (map-set energy-assets asset-id (merge asset {metadata-hash: new-metadata-hash}))
        (print {event: "asset-metadata-updated", id: asset-id})
        (ok true)
    )
)

(define-public (transfer-asset-ownership (asset-id uint) (new-owner principal))
    (let ((asset (unwrap! (map-get? energy-assets asset-id) (err ERR-ASSET-NOT-FOUND))))
        (asserts! (is-eq (get owner asset) tx-sender) (err ERR-NOT-OWNER))
        (asserts! (not (get locked asset)) (err ERR-ASSET-LOCKED))
        (map-set energy-assets asset-id (merge asset {owner: new-owner}))
        (map-delete assets-by-owner {owner: tx-sender, asset-id: asset-id})
        (map-set assets-by-owner {owner: new-owner, asset-id: asset-id} true)
        (print {event: "asset-transferred", id: asset-id, new-owner: new-owner})
        (ok true)
    )
)

(define-public (deactivate-asset (asset-id uint))
    (let ((asset (unwrap! (map-get? energy-assets asset-id) (err ERR-ASSET-NOT-FOUND))))
        (asserts! (is-eq (get owner asset) tx-sender) (err ERR-NOT-OWNER))
        (map-set energy-assets asset-id (merge asset {active: false}))
        (print {event: "asset-deactivated", id: asset-id})
        (ok true)
    )
)

(define-public (execute-asset-lock (asset-id uint))
    (let ((asset (unwrap! (map-get? energy-assets asset-id) (err ERR-ASSET-NOT-FOUND)))
          (proposal (contract-call? .Proposal get-proposal u999)))
        (asserts! (is-eq tx-sender (var-get registry-executor)) (err ERR-UNAUTHORIZED))
        (map-set energy-assets asset-id (merge asset {locked: true}))
        (print {event: "asset-locked", id: asset-id})
        (ok true)
    )
)

(define-public (update-executor)
    (begin
        (var-set registry-executor (contract-call? .Proposal get-executor-principal))
        (ok true)
    )
)

(define-read-only (get-total-assets)
    (ok (var-get asset-nonce))
)