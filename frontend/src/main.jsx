/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { switchTheme } from './services/theme.js'
import App from './App.jsx'
import './i18n/i18n.js'
import './index.css'
/* ------------------------------------------------------------
   Thèmes visuels : les 6 palettes partagent le même index de
   variables CSS (cf. src/services/theme.js) ; l'ordre d'import est
   indifférent (sélecteurs [data-theme=…]) mais « dark » reste le
   point de référence des classes utilitaires (night-* / gold-*).
   ------------------------------------------------------------ */
import './themes/dark.css'
import './themes/library.css' // ex-« light » — thème « Médiathèque » (fond photo)
import './themes/vinyl.css'
import './themes/comic.css'
import './themes/comic-books.css' // thème « Comic Books » (photo bg_comics.jpg en fond)
import './themes/neon.css' // ex-« Pastel » — thème « Néon » (halos néon sur fond sombre)

// Applique la préférence conservée (localStorage) AVANT le premier rendu :
// sans cet appel, l'attribut data-theme ne serait posé qu'après l'API
// /users/me (App.jsx) et une page colorée clignoterait « sombre ».
switchTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
