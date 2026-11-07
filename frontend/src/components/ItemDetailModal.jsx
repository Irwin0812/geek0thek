/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Modale de détail d'un disque (« vinyl ») ou d'une BD (« comic »),
 * ouverte au clic sur la carte.
 * item : DTO backend (title/artist/coverUrl/genre/… ou title/authors/coverUrl/publisher/…).
 *
 * Layout (refonte horizontale) :
 *  - mobile : empilement vertical — couverture pleine largeur en tête ;
 *  - `md` et plus : deux colonnes — la couverture occupe une colonne de
 *    gauche dédiée (« pièce maîtresse ») et le texte (titre proéminent,
 *    métadonnées compactes sur 2 colonnes) la colonne de droite. Le modal
 *    s'élargit (max-w-3xl → max-w-5xl) pour équilibrer ratio texte/image.
 */

import { useTranslation } from 'react-i18next'

/** Formate une date (ISO « AAAA-MM-JJ » de comics.added_date ou ISO8601) en jj/mm/aaaa. */
function addDateFr(value) {
  const s = String(value)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function ItemDetailModal({ type, item, onClose, onEdit }) {
  const { t } = useTranslation()
  if (!item) return null

  const isVinyl = type === 'vinyl'
  const cover = item.coverUrl
    ? isVinyl || item.coverUrl.startsWith('http')
      ? item.coverUrl
      : `${window.location.origin}${item.coverUrl}`
    : null

  // « MusicBrainz » / « Discogs » = noms propres, non traduits.
  const rows = isVinyl
    ? [
        [t('collection.fieldGenre'), item.genre],
        [t('collection.fieldLabel'), item.label],
        [t('collection.fieldReleaseYear'), item.releaseDate ? String(item.releaseDate).slice(0, 4) : null],
        [t('collection.fieldTracks'), item.trackCount > 0 ? item.trackCount : null],
        [t('collection.fieldBarcode'), item.barcode],
        // Identifiants externes cliquables vers la fiche de référence
        ['MusicBrainz', item.mbid ? (
          <a
            href={`https://musicbrainz.org/release/${item.mbid}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[11px] text-gold-300 hover:text-gold-200 underline decoration-gold-500/40"
            title={item.mbid}
          >
            MBID {String(item.mbid).slice(0, 8)}… ↗
          </a>
        ) : null],
        ['Discogs', item.discogsReleaseId ? (
          item.discogsUrl ? (
            <a
              href={item.discogsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-gold-300 hover:text-gold-200 underline decoration-gold-500/40"
            >
              #{item.discogsReleaseId} ↗
            </a>
          ) : (
            `#${item.discogsReleaseId}`
          )
        ) : null],
        [t('collection.fieldAddedDate'), item.addedDate ? addDateFr(item.addedDate) : null],
      ]
    : [
        // Série + tome (« Tome 3 » via collection.volumeBadge, cohérent cartes/liste).
        [t('collection.fieldSeries'), item.series ? `${item.series}${item.tomeNumber ? ` · ${t('collection.volumeBadge', { number: item.tomeNumber })}` : ''}` : null],
        [t('collection.fieldAuthors'), item.authors],
        [t('collection.fieldIllustrators'), item.illustrators],
        [t('collection.fieldPublisher'), item.publisher],
        [t('collection.fieldReleaseDate'), item.releaseDate ? String(item.releaseDate).slice(0, 10) : null],
        [t('collection.fieldGenre'), item.genre],
        // Remplace l'ancien champ « État » : date d'ajout à la collection.
        [t('collection.fieldAddedDate'), item.addedDate ? addDateFr(item.addedDate) : null],
        [t('collection.fieldIsbn'), item.isbn],
      ]

  const subtitle = isVinyl ? item.artist : item.authors
  const longText = isVinyl ? item.notes || item.tracklist : item.synopsis
  const longLabel = isVinyl ? (item.tracklist ? t('collection.tracksSection') : t('collection.notesSection')) : t('collection.synopsisSection')

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Carte du modal : padding généreux et uniforme, largeur élargie
          dès `md` pour accueillir la mise en page à deux colonnes. */}
      <div
        role="dialog"
        aria-modal="true"
        className="card animate-fadein flex h-max max-h-[88vh] w-full flex-col overflow-hidden
                   p-5 sm:p-6 lg:p-7 md:max-w-3xl lg:max-w-4xl xl:max-w-5xl"
      >
        {/* En-tête : nomenclature du type d'objet + fermeture (✕, haut à droite) */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-night-600/40 pb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-400/90">
            {/* Nomenclature officielle : « Détails du Disque » (et
                « Détails de la bande dessinée » pour les BD). */}
            {t(isVinyl ? 'collection.detailVinylTitle' : 'collection.detailComicTitle')}
          </h2>
          <button onClick={onClose} className="btn-ghost !p-1.5" aria-label={t('common.close')}>✕</button>
        </div>

        {/* Corps : scroll interne si le contenu dépasse (longue tracklist…) */}
        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto md:flex-row md:gap-8">
          {/* ── Colonne de gauche : la couverture, pièce maîtresse visuelle.
              Mobile : carré pleine largeur. Dès `md` : colonne dédiée plus
              large que le texte, ratio maîtrisé (carré pour les jaquettes
              1:1, 3:4 pour les couvertures BD 2:3). */}
          <div
            className={`relative w-full shrink-0 overflow-hidden rounded-xl border border-night-600/70
                        bg-gradient-to-br from-night-800 to-night-950 shadow-lg shadow-black/40
                        aspect-square md:self-center ${
              isVinyl
                ? 'md:aspect-square md:w-[46%] lg:w-[42%]'
                : 'md:aspect-[3/4] md:w-[42%] lg:w-[38%]'
            }`}
          >
            {cover ? (
              <img
                src={cover}
                alt={t(isVinyl ? 'collection.coverAltVinyl' : 'collection.coverAltComic', { title: item.title, artist: item.artist })}
                loading="lazy"
                className={`h-full w-full ${isVinyl ? 'object-cover' : 'object-contain'}`}
                onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
              />
            ) : (
              // Placeholder « Aucune image » au format de la colonne.
              <div className="grid h-full w-full place-items-center text-slate-500">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-4xl" aria-hidden="true">{isVinyl ? '💿' : '📖'}</span>
                  <span className="text-xs">{t('collection.noImage')}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Colonne de droite : typographie hiérarchisée, métadonnées compactes. */}
          <div className="min-w-0 flex-1 pr-0.5">
            <h3
              className="text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl"
              title={item.title}
            >
              {item.title}
            </h3>
            {subtitle && (
              <p className="mt-1.5 text-base text-slate-400 sm:text-lg" title={subtitle}>
                {subtitle}
              </p>
            )}

            {!isVinyl && (item.isSpecialEdition || item.isSigned) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.isSpecialEdition && (
                  <span className="badge bg-gold-500/90 text-night-950 border border-gold-400/60 font-bold">
                    {t('collection.specialEdition')}
                  </span>
                )}
                {item.isSigned && (
                  <span className="badge bg-orange-500/90 text-night-950 border border-orange-400/70 font-bold">
                    {t('collection.signed')}
                  </span>
                )}
              </div>
            )}

            {/* Métadonnées en grille 2 colonnes dès `sm` : hauteur réduite,
                lecture en diagonale classique des fiches. */}
            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {rows
                .filter(([, value]) => value || value === 0)
                .map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <dt className="shrink-0 font-medium text-slate-500">{label}</dt>
                    <dd className="break-words text-right text-slate-200">{value}</dd>
                  </div>
                ))}
            </dl>

            {item.owner && (
              // Nom complet « Prénom Nom » (nom seul si prénom vide) pour la
              // mention de propriété de la collection.
              <p className="mt-4 text-xs text-slate-500">
                {t('collection.collectionOf', { name: [item.owner.firstName, item.owner.lastName].filter(Boolean).join(' ') })}
              </p>
            )}

            {longText && (
              <div className="mt-5 border-t border-night-600/50 pt-4">
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-400/80">
                  {longLabel}
                </h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
                  {longText}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Pied du modal : actions alignées à droite. Modifier (primaire) à
            gauche, Annuler (secondaire, ferme) à l'extrême droite. Hors flux du
            corps scrollable pour ne pas perturber le défilement des pistes. */}
        <div className="mt-5 flex shrink-0 items-center justify-end gap-3 border-t border-night-600/40 pt-4">
          {onEdit && (
            <button
              onClick={() => onEdit(item)}
              className="btn-primary"
              aria-label={`${t('common.edit')} — ${item.title}`}
            >
              {t('common.edit')}
            </button>
          )}
          <button onClick={onClose} className="btn-ghost">{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
