/*
 * Copyright (C) 2026 Irwin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import {
  ArrowLeftRight,
  Download,
  Upload,
  FileSpreadsheet,
  Table2,
  Database,
  RefreshCw,
  CircleCheck,
  CircleX,
  TriangleAlert,
  Info,
  Save,
} from 'lucide-react'

/**
 * Modale « Exporter / Importer » (menu du profil) : DEUX onglets.
 *
 *  - ONGLET « Exporter » :
 *      • JSON — sauvegarde COMPLÈTE ET RELATIONNELLE de la collection
 *        (disques + BD + entités Artistes/Séries + métadonnées) : restauration
 *        fidèle ou migration vers une autre instance ;
 *      • CSV  — un fichier par bibliothèque (Disques / BD), lisible par
 *        Excel / Google Sheets / LibreOffice (BOM UTF-8, en-têtes canoniques).
 *
 *  - ONGLET « Importer » :
 *      • JSON — fichier de sauvegarde complet ; mode « Ajouter » (merge) ou
 *        « Remplacer » (efface d'abord la collection) ;
 *      • CSV  — fichier par bibliothèque avec UI de CORRESPONDANCE DES
 *        COLONNES : le CSV est parsé côté client, l'utilisateur associe chaque
 *        champ cible à une colonne source (auto-associée au chargement), puis
 *        les lignes mappées sont envoyées au backend qui valide + insère.
 *
 * Aucune dépendance ajoutée : parseur / sérialiseur CSV écrits ici en interne.
 */

// ------------------------------------------------------------
// Champs CANONIQUES des exports CSV (mêmes clés snake_case que le backend —
// un export est réimportable tel quel, auto-associé par le mapping ci-dessous).
// ------------------------------------------------------------
const VINYL_FIELDS = [
  'artist', 'title', 'track_count', 'tracklist', 'genre', 'label', 'release_date',
  'barcode', 'mbid', 'discogs_release_id', 'discogs_url', 'lastfm_url',
  'cover_url', 'artist_image', 'acquired_date', 'notes',
  'disc_type', 'is_special_edition', 'is_picture_disc', 'disks_count', 'color',
]

const COMIC_FIELDS = [
  'title', 'series', 'tome_number', 'authors', 'illustrators', 'publisher',
  'release_date', 'genre', 'isbn', 'synopsis', 'condition',
  'is_special_edition', 'is_signed', 'added_date', 'cover_url', 'series_image',
]

// Champs OBLIGATOIRE par bibliothèque (l'import les exige dans le mapping).
const REQUIRED_FIELDS = { vinyls: ['artist', 'title'], comics: ['title', 'authors', 'publisher'] }

/** Normalise un en-tête CSV pour l'auto-association : minuscules, sans
 *  ponctuation / espaces (ex. « Release Date » -> « releasedate »). */
function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Associe automatiquement chaque champ cible à une colonne source :
 *  correspondance exacte (normalisée) d'abord, sinon inclusion. */
function autoMap(headers, fields) {
  const mapping = {}
  const used = new Set()
  for (const field of fields) {
    const target = normalizeHeader(field)
    let idx = headers.findIndex((h, i) => !used.has(i) && normalizeHeader(h) === target)
    if (idx < 0) {
      idx = headers.findIndex(
        (h, i) => !used.has(i) && target.length >= 4 && normalizeHeader(h).includes(target)
      )
    }
    if (idx >= 0) used.add(idx)
    mapping[field] = idx >= 0 ? String(idx) : ''
  }
  return mapping
}

/** Parseur CSV sans dépendance : guillemets, virgules, CRLF, BOM UTF-8.
 *  Renvoie un tableau de lignes (tableaux de chaînes). */
function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '')
  if (!s.trim()) return []
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  // Lignes entièrement vides ignorées.
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

/** Télécharge un texte en fichier (Blob + <a download>). */
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Horodatage court pour les noms de fichiers (AAAA-MM-JJ). */
function stamp() {
  return new Date().toISOString().slice(0, 10)
}

export default function ExportImportModal({ open, onClose }) {
  const { t } = useTranslation()

  // ---- onglet actif : 'export' | 'import' -------------------------------
  const [tab, setTab] = useState('export')

  // ---- EXPORT -------------------------------------------------------------
  const [exportBusy, setExportBusy] = useState(false)
  const [exportMsg, setExportMsg] = useState(null) // { type: 'ok' | 'err', text }

  // ---- IMPORT -------------------------------------------------------------
  const [importFormat, setImportFormat] = useState('json') // 'json' | 'csv'
  const [mode, setMode] = useState('merge')                // 'merge' | 'replace'
  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState(null)         // { type: 'ok' | 'err', text }

  // Import JSON : fichier lu + validé côté client.
  const [jsonData, setJsonData] = useState(null)           // objet parsé
  const [jsonFileName, setJsonFileName] = useState('')
  const jsonInputRef = useRef(null)

  // Import CSV : bibliothèque cible + données parsées + mapping des colonnes.
  const [csvCollection, setCsvCollection] = useState('vinyls')
  const [csvData, setCsvData] = useState(null)             // { headers: [], rows: [[…]] }
  const [csvFileName, setCsvFileName] = useState('')
  const [mapping, setMapping] = useState({})               // { champCible: 'indexColonne' | '' }
  const csvInputRef = useRef(null)

  // Réinitialisation complète à la fermeture (jamais d'état résiduel).
  useEffect(() => {
    if (!open) return
    setTab('export')
    setExportBusy(false)
    setExportMsg(null)
    setImportFormat('json')
    setMode('merge')
    setImportBusy(false)
    setImportMsg(null)
    setJsonData(null)
    setJsonFileName('')
    setCsvCollection('vinyls')
    setCsvData(null)
    setCsvFileName('')
    setMapping({})
  }, [open])

  if (!open) return null

  const close = () => onClose()

  // ----- EXPORT -------------------------------------------------------------

  /** Export JSON : sauvegarde complète relationnelle -> fichier .json. */
  const doExportJson = async () => {
    setExportBusy(true)
    setExportMsg(null)
    try {
      const data = await api.exportImport.exportJson()
      const vinyls = Array.isArray(data.vinyls) ? data.vinyls.length : 0
      const comics = Array.isArray(data.comics) ? data.comics.length : 0
      downloadText(`geek0thek-export-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json')
      setExportMsg({ type: 'ok', text: t('exportImport.jsonExported', { vinyls, comics }) })
    } catch (err) {
      setExportMsg({ type: 'err', text: err.message })
    } finally {
      setExportBusy(false)
    }
  }

  /** Export CSV d'une bibliothèque -> fichier .csv (BOM UTF-8). */
  const doExportCsv = async (collection) => {
    setExportBusy(true)
    setExportMsg(null)
    try {
      const text = await api.exportImport.exportCsv(collection)
      downloadText(`geek0thek-${collection}-${stamp()}.csv`, text, 'text/csv;charset=utf-8')
      setExportMsg({ type: 'ok', text: t('exportImport.csvExported', { collection: t(collection === 'vinyls' ? 'exportImport.vinylsLabel' : 'exportImport.comicsLabel') }) })
    } catch (err) {
      setExportMsg({ type: 'err', text: err.message })
    } finally {
      setExportBusy(false)
    }
  }

  // ----- IMPORT JSON ----------------------------------------------------------

  /** Lit + valide le fichier JSON de sauvegarde choisi. */
  const onJsonFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setImportMsg(null)
    try {
      const parsed = JSON.parse(await file.text())
      const vinyls = Array.isArray(parsed.vinyls) ? parsed.vinyls : []
      const comics = Array.isArray(parsed.comics) ? parsed.comics : []
      if (!vinyls.length && !comics.length) {
        setJsonData(null)
        setJsonFileName('')
        setImportMsg({ type: 'err', text: t('exportImport.jsonEmpty') })
        return
      }
      setJsonData(parsed)
      setJsonFileName(file.name)
    } catch {
      setJsonData(null)
      setJsonFileName('')
      setImportMsg({ type: 'err', text: t('exportImport.jsonInvalid') })
    }
  }

  /** Lance l'import JSON (mode merge | replace). */
  const doImportJson = async () => {
    if (!jsonData) return
    setImportBusy(true)
    setImportMsg(null)
    try {
      const result = await api.exportImport.importJson({
        mode,
        vinyls: Array.isArray(jsonData.vinyls) ? jsonData.vinyls : [],
        comics: Array.isArray(jsonData.comics) ? jsonData.comics : [],
      })
      const v = (result.imported && result.imported.vinyls) || 0
      const c = (result.imported && result.imported.comics) || 0
      const sv = (result.skipped && result.skipped.vinyls) || 0
      const sc = (result.skipped && result.skipped.comics) || 0
      setImportMsg({ type: 'ok', text: t('exportImport.jsonImported', { vinyls: v, comics: c, skipped: sv + sc }) })
      setJsonData(null)
      setJsonFileName('')
    } catch (err) {
      setImportMsg({ type: 'err', text: err.message })
    } finally {
      setImportBusy(false)
    }
  }

  // ----- IMPORT CSV -------------------------------------------------------------

  /** Change de bibliothèque cible : ré-assoie le mapping sur les nouveaux champs. */
  const switchCsvCollection = (next) => {
    if (next === csvCollection) return
    setCsvCollection(next)
    if (csvData) setMapping(autoMap(csvData.headers, next === 'vinyls' ? VINYL_FIELDS : COMIC_FIELDS))
  }

  /** Lit + parse le fichier CSV choisi, puis auto-associe les colonnes. */
  const onCsvFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setImportMsg(null)
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) {
        setCsvData(null)
        setCsvFileName('')
        setMapping({})
        setImportMsg({ type: 'err', text: t('exportImport.csvEmpty') })
        return
      }
      const [headers, ...dataRows] = rows
      const fields = csvCollection === 'vinyls' ? VINYL_FIELDS : COMIC_FIELDS
      setCsvData({ headers, rows: dataRows })
      setCsvFileName(file.name)
      setMapping(autoMap(headers, fields))
    } catch {
      setCsvData(null)
      setCsvFileName('')
      setMapping({})
      setImportMsg({ type: 'err', text: t('exportImport.csvInvalid') })
    }
  }

  /** Les champs obligatoires sont-ils tous associés à une colonne ? */
  const requiredMapped = REQUIRED_FIELDS[csvCollection].every((f) => mapping[f] !== '')

  /** Construit les lignes mappées (objets à clés canoniques) pour le backend. */
  const buildMappedRows = () => {
    if (!csvData) return []
    const out = []
    for (const row of csvData.rows) {
      const obj = {}
      let any = false
      for (const [field, idx] of Object.entries(mapping)) {
        if (idx === '' || idx == null) continue
        const value = row[Number(idx)]
        if (value !== undefined && String(value).trim() !== '') {
          obj[field] = value
          any = true
        }
      }
      if (any) out.push(obj)
    }
    return out
  }

  /** Lance l'import CSV (lignes mappées -> backend, transactionnel). */
  const doImportCsv = async () => {
    if (!csvData || !requiredMapped) return
    setImportBusy(true)
    setImportMsg(null)
    try {
      const result = await api.exportImport.importCsv({
        collection: csvCollection,
        mode,
        rows: buildMappedRows(),
      })
      setImportMsg({
        type: 'ok',
        text: t('exportImport.csvImported', {
          imported: result.imported || 0,
          skipped: result.skipped || 0,
        }),
      })
      setCsvData(null)
      setCsvFileName('')
      setMapping({})
    } catch (err) {
      setImportMsg({ type: 'err', text: err.message })
    } finally {
      setImportBusy(false)
    }
  }

  // ----- sous-composants locaux ---------------------------------------------------

  /** Bouton d'onglet principal (Exporter / Importer). */
  const tabButton = (id, label, Icon) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`flex items-center gap-2 px-3.5 py-2 text-sm font-bold rounded-t-lg transition-colors ${
        tab === id
          ? 'bg-night-800/70 text-gold-300 border border-b-0 border-night-600/60'
          : 'text-slate-400 hover:text-white border border-transparent border-b-0'
      }`}
      onClick={() => { setTab(id); setExportMsg(null); setImportMsg(null) }}
    >
      <Icon size={15} aria-hidden="true" />
      {label}
    </button>
  )

  /** Bandeau de résultat (succès / erreur) — export ou import. */
  const messageBanner = (msg) => {
    if (!msg) return null
    const ok = msg.type === 'ok'
    const Icon = ok ? CircleCheck : CircleX
    return (
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
          ok
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
        }`}
      >
        <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{msg.text}</span>
      </div>
    )
  }

  /** Rangée de mode d'import (Ajouter / Remplacer) — commune JSON + CSV. */
  const modeRow = (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input type="radio" name={`import-mode-${tab}`} checked={mode === 'merge'} onChange={() => setMode('merge')} />
        {t('exportImport.modeMerge')}
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input type="radio" name={`import-mode-${tab}`} checked={mode === 'replace'} onChange={() => setMode('replace')} />
        {t('exportImport.modeReplace')}
      </label>
    </div>
  )

  const replaceWarning = mode === 'replace' && (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{t('exportImport.replaceWarning')}</span>
    </div>
  )

  const fields = csvCollection === 'vinyls' ? VINYL_FIELDS : COMIC_FIELDS

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="card w-full max-w-xl p-6 shadow-2xl shadow-black/50 flex flex-col max-h-[90vh]">
        {/* En-tête */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-white">
              <ArrowLeftRight size={18} aria-hidden="true" />
              {t('exportImport.title')}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">{t('exportImport.subtitle')}</p>
          </div>
          <button onClick={close} className="btn-ghost !p-1.5" aria-label={t('common.close')}>✕</button>
        </div>

        {/* Onglets : Exporter | Importer */}
        <div className="flex gap-1 border-b border-night-600/60 mb-4" role="tablist" aria-label={t('exportImport.title')}>
          {tabButton('export', t('exportImport.tabExport'), Download)}
          {tabButton('import', t('exportImport.tabImport'), Upload)}
        </div>

        <div className="overflow-y-auto pr-1 -mr-1 flex flex-col gap-4">
          {/* ============================ ONGLET EXPORTER ===================== */}
          {tab === 'export' && (
            <>
              {/* JSON — sauvegarde complète relationnelle */}
              <section className="rounded-lg border border-night-600/60 p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Database size={16} className="text-gold-300" aria-hidden="true" />
                  JSON — {t('exportImport.jsonTitle')}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{t('exportImport.jsonDesc')}</p>
                <button className="btn-primary self-start" disabled={exportBusy} onClick={doExportJson}>
                  <Download size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                  {exportBusy ? t('common.loading') : t('exportImport.exportBtn')}
                </button>
              </section>

              {/* CSV — un fichier par bibliothèque */}
              <section className="rounded-lg border border-night-600/60 p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <FileSpreadsheet size={16} className="text-gold-300" aria-hidden="true" />
                  CSV — {t('exportImport.csvTitle')}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{t('exportImport.csvDesc')}</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={exportBusy} onClick={() => doExportCsv('vinyls')}>
                    <Table2 size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                    {t('exportImport.vinylsLabel')} (.csv)
                  </button>
                  <button className="btn-primary" disabled={exportBusy} onClick={() => doExportCsv('comics')}>
                    <Table2 size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                    {t('exportImport.comicsLabel')} (.csv)
                  </button>
                </div>
              </section>

              {messageBanner(exportMsg)}
            </>
          )}

          {/* ============================ ONGLET IMPORTER ===================== */}
          {tab === 'import' && (
            <>
              {/* Choix du format : JSON | CSV */}
              <div className="flex gap-1 border-b border-night-600/40" role="tablist" aria-label={t('exportImport.formatLabel')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={importFormat === 'json'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-t-lg transition-colors ${
                    importFormat === 'json'
                      ? 'bg-night-800/70 text-gold-300 border border-b-0 border-night-600/40'
                      : 'text-slate-400 hover:text-white border border-transparent border-b-0'
                  }`}
                  onClick={() => { setImportFormat('json'); setImportMsg(null) }}
                >
                  <Database size={13} aria-hidden="true" />
                  JSON
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={importFormat === 'csv'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-t-lg transition-colors ${
                    importFormat === 'csv'
                      ? 'bg-night-800/70 text-gold-300 border border-b-0 border-night-600/40'
                      : 'text-slate-400 hover:text-white border border-transparent border-b-0'
                  }`}
                  onClick={() => { setImportFormat('csv'); setImportMsg(null) }}
                >
                  <FileSpreadsheet size={13} aria-hidden="true" />
                  CSV
                </button>
              </div>

              {/* ------------------------- IMPORT JSON ------------------------ */}
              {importFormat === 'json' && (
                <section className="flex flex-col gap-3">
                  <p className="text-xs text-slate-400 leading-relaxed">{t('exportImport.jsonImportDesc')}</p>

                  {!jsonData ? (
                    <button className="btn-primary self-start" onClick={() => jsonInputRef.current?.click()}>
                      <Upload size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                      {t('exportImport.chooseFile')}
                    </button>
                  ) : (
                    <div className="rounded-lg border border-night-600/60 p-3 flex flex-col gap-2">
                      <p className="flex items-center gap-2 text-sm text-slate-200">
                        <CircleCheck size={15} className="text-emerald-300 shrink-0" aria-hidden="true" />
                        <span className="truncate">{jsonFileName}</span>
                      </p>
                      <p className="text-xs text-slate-400">
                        {t('exportImport.jsonSummary', {
                          vinyls: Array.isArray(jsonData.vinyls) ? jsonData.vinyls.length : 0,
                          comics: Array.isArray(jsonData.comics) ? jsonData.comics.length : 0,
                        })}
                      </p>
                    </div>
                  )}
                  <input ref={jsonInputRef} type="file" accept=".json,application/json" className="hidden" onChange={onJsonFile} />

                  {modeRow}
                  {replaceWarning}

                  <button className="btn-primary self-start" disabled={!jsonData || importBusy} onClick={doImportJson}>
                    <Save size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                    {importBusy ? t('common.loading') : t('exportImport.importBtn')}
                  </button>
                </section>
              )}

              {/* ------------------------- IMPORT CSV ------------------------- */}
              {importFormat === 'csv' && (
                <section className="flex flex-col gap-3">
                  <p className="text-xs text-slate-400 leading-relaxed">{t('exportImport.csvImportDesc')}</p>

                  {/* Bibliothèque cible : Disques | BD */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={Boolean(csvData)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                        csvCollection === 'vinyls'
                          ? 'border-gold-400/60 bg-gold-400/10 text-gold-300'
                          : 'border-night-600/60 text-slate-400 hover:text-white'
                      }`}
                      onClick={() => switchCsvCollection('vinyls')}
                    >
                      {t('exportImport.vinylsLabel')}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(csvData)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                        csvCollection === 'comics'
                          ? 'border-gold-400/60 bg-gold-400/10 text-gold-300'
                          : 'border-night-600/60 text-slate-400 hover:text-white'
                      }`}
                      onClick={() => switchCsvCollection('comics')}
                    >
                      {t('exportImport.comicsLabel')}
                    </button>
                  </div>

                  {!csvData ? (
                    <button className="btn-primary self-start" onClick={() => csvInputRef.current?.click()}>
                      <Upload size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                      {t('exportImport.chooseFile')}
                    </button>
                  ) : (
                    <>
                      <div className="rounded-lg border border-night-600/60 p-3 flex flex-col gap-2">
                        <p className="flex items-center gap-2 text-sm text-slate-200">
                          <CircleCheck size={15} className="text-emerald-300 shrink-0" aria-hidden="true" />
                          <span className="truncate">{csvFileName}</span>
                        </p>
                        <p className="text-xs text-slate-400">
                          {t('exportImport.csvSummary', { rows: csvData.rows.length })}
                        </p>

                        {/* CORRESPONDANCE DES COLONNES : chaque champ cible est
                            associé à une colonne source (select) — auto-associé
                            au chargement, ajustable manuellement. */}
                        <div className="mt-1 flex flex-col gap-1.5">
                          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                            <Info size={13} aria-hidden="true" />
                            {t('exportImport.mappingTitle')}
                          </p>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-h-56 overflow-y-auto pr-1">
                            {fields.map((field) => (
                              <label key={field} className="flex flex-col gap-0.5 text-[11px] text-slate-400">
                                <span className="truncate">
                                  {t(`exportImport.field.${field}`)}
                                  {REQUIRED_FIELDS[csvCollection].includes(field) && (
                                    <span className="text-gold-300"> *</span>
                                  )}
                                </span>
                                <select
                                  className="input !py-1 !text-xs"
                                  value={mapping[field] ?? ''}
                                  onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                                >
                                  <option value="">{t('exportImport.mappingIgnore')}</option>
                                  {csvData.headers.map((h, i) => (
                                    <option key={i} value={String(i)}>{h || `#${i + 1}`}</option>
                                  ))}
                                </select>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      {modeRow}
                      {replaceWarning}

                      <button
                        className="btn-primary self-start"
                        disabled={importBusy || !requiredMapped}
                        onClick={doImportCsv}
                        title={!requiredMapped ? t('exportImport.requiredFields') : ''}
                      >
                        <Save size={15} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                        {importBusy ? t('common.loading') : t('exportImport.importBtn')}
                      </button>
                      {!requiredMapped && (
                        <p className="flex items-center gap-1.5 text-xs text-amber-300">
                          <TriangleAlert size={13} aria-hidden="true" />
                          {t('exportImport.requiredFields')}
                        </p>
                      )}
                    </>
                  )}
                  <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onCsvFile} />

                  {/* Bouton « Recharger » : repart sur un autre fichier. */}
                  {csvData && (
                    <button
                      className="btn-ghost self-start !text-xs"
                      onClick={() => { setCsvData(null); setCsvFileName(''); setMapping({}); setImportMsg(null) }}
                    >
                      <RefreshCw size={13} aria-hidden="true" className="mr-1.5 inline-block align-[-2px]" />
                      {t('exportImport.chooseFile')}
                    </button>
                  )}
                </section>
              )}

              {messageBanner(importMsg)}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
