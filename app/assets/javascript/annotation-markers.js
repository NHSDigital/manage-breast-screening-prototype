// app/assets/javascript/annotation-markers.js
//
// Reusable module for rendering and interacting with annotation markers on
// mammogram image panels. Works with the app-annotation-images component,
// annotation-list component, annotation-tabs, and the annotation modal.
//
// Usage:
//   For interactive mode (place, drag, edit):
//     AnnotationMarkers.init({ container, annotations, activeSide, saveUrl })
//
//   For readonly mode (just correct marker positions):
//     AnnotationMarkers.correctAll()

;(function () {
  "use strict"

  var CONCERN_LABELS = {
    "1": "1 – Normal",
    "2": "2 – Benign",
    "3": "3 – Indeterminate",
    "4": "4 – Suspicious",
    "5": "5 – Highly suspicious"
  }

  // ─── Coordinate utilities ────────────────────────────────────────────────────

  function getImageRect(panel) {
    var img = panel.querySelector("img")
    if (!img || !img.naturalWidth || !img.naturalHeight) return null

    var panelW = panel.clientWidth
    var panelH = panel.clientHeight
    var scale = Math.min(panelW / img.naturalWidth, panelH / img.naturalHeight)
    var renderedW = img.naturalWidth * scale
    var renderedH = img.naturalHeight * scale

    var isLeft = panel.classList.contains("app-annotation-images__panel--left") ||
                 panel.classList.contains("app-ann-v2__image-panel--left")
    var offsetX = isLeft ? 0 : (panelW - renderedW)
    var offsetY = 0

    return { offsetX: offsetX, offsetY: offsetY, renderedW: renderedW, renderedH: renderedH, panelW: panelW, panelH: panelH }
  }

  function imageFractionToContainerPercent(pos, panel) {
    var rect = getImageRect(panel)
    if (!rect) return { x: pos.x * 100, y: pos.y * 100 }
    return {
      x: (rect.offsetX + pos.x * rect.renderedW) / rect.panelW * 100,
      y: (rect.offsetY + pos.y * rect.renderedH) / rect.panelH * 100
    }
  }

  function containerFractionToImageFraction(cx, cy, panel) {
    var rect = getImageRect(panel)
    if (!rect) return { x: cx, y: cy }
    return {
      x: Math.max(0, Math.min(1, (cx * rect.panelW - rect.offsetX) / rect.renderedW)),
      y: Math.max(0, Math.min(1, (cy * rect.panelH - rect.offsetY) / rect.renderedH))
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2, 9)
  }

  // ─── Main initialiser ───────────────────────────────────────────────────────

  function init(options) {
    var opts = options || {}

    // The root container element — all queries are scoped to this
    var container = opts.container
    if (typeof container === "string") container = document.querySelector(container)
    if (!container) {
      // Fallback: auto-correct any static markers and exit
      correctAllMarkers()
      return
    }

    // State
    var annotations = (opts.annotations || []).map(function (a) { return Object.assign({}, a) })
    var activeSide = opts.activeSide || "right"
    var activeAnnotationId = null
    var modalAnnotationId = null
    var annotationCounter = annotations.length
    var placedThisHover = new Set()

    // Config
    var saveUrl = opts.saveUrl || null // URL to POST annotations JSON to

    // DOM references
    var annModal = document.getElementById("ann-annotation-modal")

    // Helpers
    function getAnnotation(id) {
      return annotations.find(function (a) { return a.id === id })
    }

    function getPanelKeysForSide(side) {
      var panels = container.querySelectorAll('[data-panel-side="' + side + '"] .app-annotation-images__panel[data-view]')
      var keys = []
      panels.forEach(function (p) {
        if (!p.classList.contains("app-annotation-images__panel--no-image")) {
          keys.push(p.dataset.view)
        }
      })
      return keys
    }

    function buildDisplayIndices() {
      var indices = {}
      var rn = 1, ln = 1
      annotations.filter(function (a) { return a.side === "right" && (a.abnormalityTypes && a.abnormalityTypes.length || a.levelOfConcern) }).forEach(function (a) { indices[a.id] = rn++ })
      annotations.filter(function (a) { return a.side === "left" && (a.abnormalityTypes && a.abnormalityTypes.length || a.levelOfConcern) }).forEach(function (a) { indices[a.id] = ln++ })
      return indices
    }

    // ─── Rendering: markers ──────────────────────────────────────────────────

    function renderMarkers() {
      // Remove all existing markers from panels in active side
      container.querySelectorAll('[data-panel-side="' + activeSide + '"] .app-ann-marker').forEach(function (m) { m.remove() })

      var sideAnnotations = annotations.filter(function (a) { return a.side === activeSide })
      var displayIndex = buildDisplayIndices()

      sideAnnotations.forEach(function (ann) {
        if (!ann.positions) return
        var isActive = ann.id === activeAnnotationId

        Object.keys(ann.positions).forEach(function (viewKey) {
          var pos = ann.positions[viewKey]
          var panelEl = container.querySelector('[data-panel-side="' + activeSide + '"] [data-view="' + viewKey + '"]')
          if (!panelEl) return

          var containerPos = imageFractionToContainerPercent(pos, panelEl)

          var marker = document.createElement("div")
          marker.className = "app-ann-marker" + (isActive ? " is-active" : "")
          marker.style.left = containerPos.x + "%"
          marker.style.top = containerPos.y + "%"
          marker.dataset.annId = ann.id
          marker.dataset.viewKey = viewKey
          marker.tabIndex = 0
          marker.setAttribute("role", "button")
          marker.setAttribute("aria-label", "Annotation " + (displayIndex[ann.id] || "?"))

          var badge = document.createElement("div")
          badge.className = "app-ann-marker__badge"
          badge.textContent = displayIndex[ann.id] || "?"
          badge.setAttribute("aria-hidden", "true")
          marker.appendChild(badge)

          var removeBtn = document.createElement("button")
          removeBtn.className = "app-ann-marker__remove"
          removeBtn.type = "button"
          removeBtn.setAttribute("aria-label", "Remove marker")
          removeBtn.innerHTML = "&minus;"
          removeBtn.addEventListener("click", function (e) {
            e.stopPropagation()
            var targetAnn = getAnnotation(ann.id)
            if (targetAnn && targetAnn.positions) {
              delete targetAnn.positions[viewKey]
              if (Object.keys(targetAnn.positions).length === 0) {
                var idx = annotations.findIndex(function (a) { return a.id === ann.id })
                if (idx !== -1) annotations.splice(idx, 1)
                if (activeAnnotationId === ann.id) activeAnnotationId = null
              }
            }
            renderMarkers()
            renderSidebar()
            autoSave()
          })
          marker.appendChild(removeBtn)

          attachMarkerHandlers(marker)
          panelEl.appendChild(marker)
        })
      })
    }

    function attachMarkerHandlers(marker) {
      marker.addEventListener("click", function (e) {
        e.stopPropagation()
        var targetAnn = getAnnotation(this.dataset.annId)
        if (targetAnn && !(targetAnn.abnormalityTypes && targetAnn.abnormalityTypes.length) && !targetAnn.levelOfConcern) {
          var panelKeys = getPanelKeysForSide(targetAnn.side)
          if (panelKeys.length > 0 && panelKeys.every(function (k) { return targetAnn.positions && targetAnn.positions[k] })) {
            openModal(targetAnn.id)
          }
        }
      })

      marker.addEventListener("mousedown", function (e) {
        e.stopPropagation()
        var annId = this.dataset.annId
        var viewKey = this.dataset.viewKey
        var el = this

        if (activeAnnotationId !== annId) {
          activeAnnotationId = annId
          renderMarkers()
          renderSidebar()
        }

        var hasDragged = false
        var startX = e.clientX
        var startY = e.clientY

        function onMove(moveEvent) {
          var moved = Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3
          if (moved && !hasDragged) {
            hasDragged = true
            el.classList.add("dragging")
          }
          if (hasDragged) {
            var panel = el.closest(".app-annotation-images__panel")
            if (!panel) return
            var rect = panel.getBoundingClientRect()
            el.style.left = Math.max(0, Math.min(100, ((moveEvent.clientX - rect.left) / rect.width) * 100)) + "%"
            el.style.top = Math.max(0, Math.min(100, ((moveEvent.clientY - rect.top) / rect.height) * 100)) + "%"
          }
        }

        function onUp(upEvent) {
          document.removeEventListener("mousemove", onMove)
          document.removeEventListener("mouseup", onUp)
          el.classList.remove("dragging")

          if (hasDragged) {
            var panel = el.closest(".app-annotation-images__panel")
            if (panel) {
              var rect = panel.getBoundingClientRect()
              var cx = Math.max(0, Math.min(1, (upEvent.clientX - rect.left) / rect.width))
              var cy = Math.max(0, Math.min(1, (upEvent.clientY - rect.top) / rect.height))
              var imagePos = containerFractionToImageFraction(cx, cy, panel)
              var ann = getAnnotation(annId)
              if (ann) {
                if (!ann.positions) ann.positions = {}
                ann.positions[viewKey] = { x: Math.round(imagePos.x * 1000) / 1000, y: Math.round(imagePos.y * 1000) / 1000 }
              }
            }
            renderMarkers()
            renderSidebar()
            autoSave()
          }
        }

        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
      })

      marker.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return
        e.stopPropagation()
        e.preventDefault()
        activeAnnotationId = this.dataset.annId
        renderMarkers()
        renderSidebar()
      })
    }

    // ─── Rendering: sidebar / annotation list ────────────────────────────────

    function renderSidebar() {
      var displayIndex = buildDisplayIndices()
      var sideAnnotations = annotations.filter(function (a) { return a.side === activeSide })

      // Find sidebar scroll container for active side
      var sidebarScroll = container.querySelector('[data-panel-side="' + activeSide + '"] .app-ann-v2__sidebar-scroll')
      if (!sidebarScroll) return

      var html = '<h3 class="app-ann-v2__sidebar-heading">Annotations</h3>'
      html += '<div class="app-annotation-list">'

      if (sideAnnotations.length === 0) {
        html += '<p class="app-annotation-list__empty">No annotations</p>'
      }

      sideAnnotations.forEach(function (ann) {
        var isActive = ann.id === activeAnnotationId
        var isIncomplete = !(ann.abnormalityTypes && ann.abnormalityTypes.length) && !ann.levelOfConcern
        var typeLabel = "Type not set"
        if (ann.abnormalityTypes && ann.abnormalityTypes.length) {
          typeLabel = Array.isArray(ann.abnormalityTypes) ? ann.abnormalityTypes.join(", ") : ann.abnormalityTypes
        }
        var concernLabel = ann.levelOfConcern ? CONCERN_LABELS[ann.levelOfConcern] : ""

        html += '<div class="app-annotation-list__card' +
          (isActive ? ' is-active' : '') +
          '" data-ann-id="' + ann.id + '" tabindex="0" role="button"' +
          ' aria-pressed="' + (isActive ? "true" : "false") + '"' +
          ' aria-label="Annotation ' + (displayIndex[ann.id] || "?") + '">'

        html += '<div class="app-annotation-list__header">' +
          '<span class="app-annotation-list__number">' + (displayIndex[ann.id] || "?") + '</span>' +
          '<div class="app-annotation-list__body">' +
          '<span class="app-annotation-list__type">' + typeLabel + '</span>'

        if (concernLabel) {
          html += '<p class="app-annotation-list__meta">' + concernLabel + '</p>'
        }
        if (ann.comment) {
          html += '<p class="app-annotation-list__meta">' + ann.comment + '</p>'
        }

        if (isIncomplete) {
          html += '<div class="app-annotation-list__actions">' +
            '<button class="nhsuk-button nhsuk-button--small nhsuk-u-margin-bottom-0" type="button" data-action="edit" data-ann-id="' + ann.id + '">Add details</button>' +
            ' <button class="app-link-button app-link-button--warning" type="button" data-action="delete-annotation" data-ann-id="' + ann.id + '">Remove</button>' +
            '</div>'
        } else {
          html += '<div class="app-annotation-list__actions">' +
            '<button class="app-link-button" type="button" data-action="edit" data-ann-id="' + ann.id + '">Edit</button>' +
            '</div>'
        }

        html += '</div></div></div>'
      })

      // Add annotation button
      var addBtnText = sideAnnotations.length > 0 ? "Add another annotation" : "Add annotation"
      var hasIncomplete = annotations.some(function (a) { return !(a.abnormalityTypes && a.abnormalityTypes.length) && !a.levelOfConcern })
      var addBtnDisabled = hasIncomplete ? ' disabled title="Complete the current annotation before adding another"' : ""
      html += '<button class="nhsuk-button nhsuk-button--secondary nhsuk-button--small" type="button" data-action="add-annotation" data-side="' + activeSide + '"' + addBtnDisabled + '>' + addBtnText + '</button>'

      html += '</div>'

      sidebarScroll.innerHTML = html
    }

    // ─── Rendering: tabs ─────────────────────────────────────────────────────

    function renderTabs() {
      var tabs = container.querySelectorAll("[data-thumb-side]")
      tabs.forEach(function (tab) {
        var side = tab.dataset.thumbSide
        tab.classList.toggle("is-active", side === activeSide)
        tab.classList.toggle("is-inactive", side !== activeSide)
      })

      // Update count badges
      ;["right", "left"].forEach(function (side) {
        var countEl = container.querySelector('[data-side-count="' + side + '"]')
        if (!countEl) return
        var count = annotations.filter(function (a) {
          return a.side === side && (a.abnormalityTypes && a.abnormalityTypes.length || a.levelOfConcern)
        }).length
        countEl.textContent = count
        countEl.classList.toggle("app-count--blue", count > 0)
      })

      // Also update hidden count spans used by auto-open script
      ;["right", "left"].forEach(function (side) {
        var countSpan = document.querySelector('[data-annotation-count="' + side + '"]')
        if (countSpan) {
          countSpan.dataset.count = annotations.filter(function (a) { return a.side === side }).length
        }
      })
    }

    // ─── Cursor preview ──────────────────────────────────────────────────────

    var cursorPreview = document.createElement("div")
    cursorPreview.className = "app-ann-cursor-preview"
    cursorPreview.setAttribute("aria-hidden", "true")
    cursorPreview.hidden = true

    var cursorPreviewBadge = document.createElement("div")
    cursorPreviewBadge.className = "app-ann-cursor-preview__badge"
    cursorPreviewBadge.hidden = true
    cursorPreview.appendChild(cursorPreviewBadge)

    function updateCursorPreview(panel, event) {
      if (event.target.closest(".app-ann-marker") || event.target.closest(".app-annotation-images__zoom-btn")) {
        hideCursorPreview()
        return
      }
      var rect = panel.getBoundingClientRect()
      var x = ((event.clientX - rect.left) / rect.width) * 100
      var y = ((event.clientY - rect.top) / rect.height) * 100
      if (cursorPreview.parentElement !== panel) panel.appendChild(cursorPreview)

      var viewKey = panel.dataset.view
      var displayIndex = buildDisplayIndices()

      var incompleteAnn = annotations.find(function (a) {
        return a.side === activeSide && !(a.abnormalityTypes && a.abnormalityTypes.length) && !a.levelOfConcern
      })
      if (incompleteAnn) {
        if (placedThisHover.has(viewKey)) {
          hideCursorPreview()
          return
        }
        var existingMarker = panel.querySelector('.app-ann-marker[data-ann-id="' + incompleteAnn.id + '"]')
        if (existingMarker) existingMarker.classList.add("is-ghost")
        cursorPreviewBadge.textContent = "?"
        cursorPreviewBadge.hidden = false
        cursorPreview.hidden = false
        cursorPreview.style.left = x + "%"
        cursorPreview.style.top = y + "%"
        return
      }

      var ann = activeAnnotationId ? getAnnotation(activeAnnotationId) : null
      if (ann && ann.side === activeSide && (!ann.positions || !ann.positions[viewKey])) {
        cursorPreviewBadge.textContent = displayIndex[ann.id] || "?"
        cursorPreviewBadge.hidden = false
      } else {
        cursorPreviewBadge.textContent = "+"
        cursorPreviewBadge.hidden = false
      }
      cursorPreview.hidden = false
      cursorPreview.style.left = x + "%"
      cursorPreview.style.top = y + "%"
    }

    function hideCursorPreview() {
      var ghostMarker = document.querySelector(".app-ann-marker.is-ghost")
      if (ghostMarker) ghostMarker.classList.remove("is-ghost")
      cursorPreview.hidden = true
    }

    // ─── Image click handler ─────────────────────────────────────────────────

    function handleImageClick(event) {
      // Don't handle clicks on markers or zoom buttons
      if (event.target.closest(".app-ann-marker") || event.target.closest(".app-annotation-images__zoom-btn")) return

      var panel = event.currentTarget
      var viewKey = panel.dataset.view
      var rect = panel.getBoundingClientRect()
      var cx = (event.clientX - rect.left) / rect.width
      var cy = (event.clientY - rect.top) / rect.height
      var imagePos = containerFractionToImageFraction(cx, cy, panel)
      var x = Math.round(imagePos.x * 1000) / 1000
      var y = Math.round(imagePos.y * 1000) / 1000

      // If there's an incomplete annotation on this side, all clicks update it
      var incompleteAnn = annotations.find(function (a) {
        return a.side === activeSide && !(a.abnormalityTypes && a.abnormalityTypes.length) && !a.levelOfConcern
      })
      if (incompleteAnn) {
        if (!incompleteAnn.positions) incompleteAnn.positions = {}
        incompleteAnn.positions[viewKey] = { x: x, y: y }
        activeAnnotationId = incompleteAnn.id
        placedThisHover.add(viewKey)
        renderMarkers()
        renderSidebar()
        var panelKeys = getPanelKeysForSide(activeSide)
        var allCovered = panelKeys.length > 0 && panelKeys.every(function (k) { return incompleteAnn.positions[k] })
        if (allCovered) openModal(incompleteAnn.id)
        autoSave()
        return
      }

      // Try to add to the active complete annotation
      if (activeAnnotationId) {
        var ann = getAnnotation(activeAnnotationId)
        if (ann && ann.side === activeSide) {
          if (!ann.positions) ann.positions = {}
          if (!ann.positions[viewKey]) {
            ann.positions[viewKey] = { x: x, y: y }
            renderMarkers()
            renderSidebar()
            autoSave()
            return
          }
        }
        activeAnnotationId = null
      }

      // Create a new annotation
      var newId = uid()
      annotations.push({
        id: newId,
        side: activeSide,
        positions: {},
        annotationNumber: ++annotationCounter
      })
      annotations[annotations.length - 1].positions[viewKey] = { x: x, y: y }
      activeAnnotationId = newId

      renderMarkers()
      renderSidebar()

      var newAnn = getAnnotation(newId)
      var panelKeys2 = getPanelKeysForSide(activeSide)
      var allCovered2 = panelKeys2.length > 0 && newAnn && panelKeys2.every(function (k) { return newAnn.positions[k] })
      if (allCovered2) openModal(newId)
      autoSave()
    }

    // ─── Sidebar event delegation ────────────────────────────────────────────

    function handleSidebarClick(e) {
      var editBtn = e.target.closest('[data-action="edit"]')
      var addBtn = e.target.closest('[data-action="add-annotation"]')
      var deleteBtn = e.target.closest('[data-action="delete-annotation"]')
      var card = e.target.closest(".app-annotation-list__card")

      if (editBtn) {
        e.stopPropagation()
        openModal(editBtn.dataset.annId)
        return
      }

      if (deleteBtn) {
        e.stopPropagation()
        var annId = deleteBtn.dataset.annId
        var idx = annotations.findIndex(function (a) { return a.id === annId })
        if (idx !== -1) annotations.splice(idx, 1)
        if (activeAnnotationId === annId) activeAnnotationId = null
        renderMarkers()
        renderSidebar()
        renderTabs()
        autoSave()
        return
      }

      if (addBtn) {
        var hasIncomplete = annotations.some(function (a) {
          return !(a.abnormalityTypes && a.abnormalityTypes.length) && !a.levelOfConcern
        })
        if (hasIncomplete) return

        var side = addBtn.dataset.side
        if (side !== activeSide) {
          switchSide(side)
        }
        var newId = uid()
        annotations.push({
          id: newId,
          side: activeSide,
          positions: {},
          annotationNumber: ++annotationCounter
        })
        activeAnnotationId = newId
        renderMarkers()
        renderSidebar()
        return
      }

      if (card && card.dataset.annId) {
        var clickedAnnId = card.dataset.annId
        activeAnnotationId = clickedAnnId
        var clickedAnn = getAnnotation(clickedAnnId)
        if (clickedAnn && clickedAnn.side !== activeSide) {
          switchSide(clickedAnn.side)
        }
        renderSidebar()
        renderMarkers()
      }
    }

    // ─── Modal ───────────────────────────────────────────────────────────────

    function openModal(annId) {
      if (!annModal) return
      modalAnnotationId = annId
      var ann = getAnnotation(annId)
      var isIncomplete = !ann || (!(ann.abnormalityTypes && ann.abnormalityTypes.length) && !ann.levelOfConcern)

      document.getElementById("ann-modal-title").textContent = isIncomplete ? "Add annotation" : "Update annotation"
      document.getElementById("ann-modal-save").textContent = isIncomplete ? "Add annotation" : "Update annotation"

      // Set abnormality types
      var currentTypes = (ann && ann.abnormalityTypes) ? (Array.isArray(ann.abnormalityTypes) ? ann.abnormalityTypes : [ann.abnormalityTypes]) : []
      var abTypesEl = document.querySelector('[name="imageReadingTemp[annotationTemp][abnormalityTypes]"]')
      if (abTypesEl && abTypesEl.tagName === "SELECT") {
        abTypesEl.value = currentTypes[0] || ""
      } else {
        document.querySelectorAll('[name="imageReadingTemp[annotationTemp][abnormalityTypes]"]').forEach(function (cb) {
          cb.checked = currentTypes.includes(cb.value)
        })
      }

      // Set level of concern
      document.querySelectorAll('[name="imageReadingTemp[annotationTemp][levelOfConcern]"]').forEach(function (radio) {
        radio.checked = radio.value === (ann && ann.levelOfConcern ? ann.levelOfConcern : "")
      })

      // Set comment
      var commentEl = document.getElementById("comment")
      if (commentEl) commentEl.value = ann && ann.comment ? ann.comment : ""

      document.getElementById("ann-modal-delete").hidden = false

      annModal.hidden = false
      annModal.classList.add("app-modal--open")
      var firstInput = document.querySelector('[name="imageReadingTemp[annotationTemp][abnormalityTypes]"]')
      if (firstInput) firstInput.focus()
    }

    function closeModal() {
      if (!annModal) return
      annModal.hidden = true
      annModal.classList.remove("app-modal--open")
      modalAnnotationId = null
    }

    function saveModal() {
      if (!modalAnnotationId) return
      var ann = getAnnotation(modalAnnotationId)
      if (!ann) return

      var abTypesEl = document.querySelector('[name="imageReadingTemp[annotationTemp][abnormalityTypes]"]')
      var savedTypes
      if (abTypesEl && abTypesEl.tagName === "SELECT") {
        savedTypes = abTypesEl.value ? [abTypesEl.value] : []
      } else {
        savedTypes = Array.from(document.querySelectorAll('[name="imageReadingTemp[annotationTemp][abnormalityTypes]"]:checked')).map(function (cb) { return cb.value })
      }
      ann.abnormalityTypes = savedTypes.length ? savedTypes : null
      ann.levelOfConcern = (document.querySelector('[name="imageReadingTemp[annotationTemp][levelOfConcern]"]:checked') || {}).value || null
      var commentEl = document.getElementById("comment")
      ann.comment = commentEl ? commentEl.value || null : null

      activeAnnotationId = modalAnnotationId

      closeModal()
      renderTabs()
      renderMarkers()
      renderSidebar()
      autoSave()
    }

    function deleteModalAnnotation() {
      if (!modalAnnotationId) return
      var idx = annotations.findIndex(function (a) { return a.id === modalAnnotationId })
      if (idx !== -1) annotations.splice(idx, 1)
      if (activeAnnotationId === modalAnnotationId) activeAnnotationId = null
      closeModal()
      renderTabs()
      renderMarkers()
      renderSidebar()
      autoSave()
    }

    function cancelModal() {
      closeModal()
      renderMarkers()
      renderSidebar()
    }

    // ─── Tab switching ───────────────────────────────────────────────────────

    function switchSide(side) {
      activeSide = side
      activeAnnotationId = null

      // Show/hide tab panels
      container.querySelectorAll("[data-panel-side]").forEach(function (panel) {
        panel.hidden = panel.dataset.panelSide !== side
      })

      renderTabs()
      bindImagePanels()
      renderMarkers()
      renderSidebar()
    }

    function handleTabClick(event) {
      var side = event.currentTarget.dataset.thumbSide
      if (!side || side === activeSide) return
      switchSide(side)
    }

    // ─── Auto-save ───────────────────────────────────────────────────────────

    function autoSave() {
      if (!saveUrl) return

      fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotationsJson: JSON.stringify(annotations) })
      }).catch(function () {
        // Silently fail — prototype
      })
    }

    // ─── Lightbox (zoomed single image) ─────────────────────────────────────

    var lightbox = document.getElementById("ann-lightbox")
    var lightboxPanel = document.getElementById("ann-lightbox-panel")
    var lightboxViewKey = null

    function openLightbox(sourcePanel) {
      if (!lightbox || !lightboxPanel) return
      lightboxViewKey = sourcePanel.dataset.view
      var img = sourcePanel.querySelector("img")
      if (!img) return

      var isLeft = sourcePanel.classList.contains("app-annotation-images__panel--left")

      lightboxPanel.innerHTML = ""
      lightboxPanel.className = "app-ann-v2__lightbox-panel app-ann-v2__image-panel app-ann-v2__image-panel--" + (isLeft ? "left" : "right")

      var lightboxImg = document.createElement("img")
      lightboxImg.src = img.src
      lightboxImg.alt = img.alt
      lightboxImg.draggable = false
      lightboxPanel.appendChild(lightboxImg)

      lightboxImg.addEventListener("load", function () {
        renderLightboxMarkers()
      }, { once: true })
      if (lightboxImg.complete) renderLightboxMarkers()

      lightbox.hidden = false
      document.getElementById("ann-lightbox-close").focus()

      lightboxPanel.addEventListener("mousemove", onLightboxMouseMove)
      lightboxPanel.addEventListener("mouseleave", hideLightboxPreview)
      lightboxPanel.addEventListener("click", onLightboxClick)
    }

    function closeLightbox() {
      if (!lightbox) return
      lightbox.hidden = true
      lightboxPanel.removeEventListener("mousemove", onLightboxMouseMove)
      lightboxPanel.removeEventListener("mouseleave", hideLightboxPreview)
      lightboxPanel.removeEventListener("click", onLightboxClick)
      lightboxPanel.innerHTML = ""
      lightboxViewKey = null
    }

    function renderLightboxMarkers() {
      if (!lightboxPanel || !lightboxViewKey) return
      lightboxPanel.querySelectorAll(".app-ann-marker").forEach(function (m) { m.remove() })

      var sideAnnotations = annotations.filter(function (a) { return a.side === activeSide })
      var displayIndex = buildDisplayIndices()

      sideAnnotations.forEach(function (ann) {
        if (!ann.positions || !ann.positions[lightboxViewKey]) return
        var pos = ann.positions[lightboxViewKey]
        var isActive = ann.id === activeAnnotationId

        var containerPos = imageFractionToContainerPercent(pos, lightboxPanel)

        var marker = document.createElement("div")
        marker.className = "app-ann-marker" + (isActive ? " is-active" : "")
        marker.style.left = containerPos.x + "%"
        marker.style.top = containerPos.y + "%"
        marker.dataset.annId = ann.id
        marker.dataset.viewKey = lightboxViewKey
        marker.tabIndex = 0
        marker.setAttribute("role", "button")
        marker.setAttribute("aria-label", "Annotation " + (displayIndex[ann.id] || "?"))

        var badge = document.createElement("div")
        badge.className = "app-ann-marker__badge"
        badge.textContent = displayIndex[ann.id] || "?"
        badge.setAttribute("aria-hidden", "true")
        marker.appendChild(badge)

        var removeBtn = document.createElement("button")
        removeBtn.className = "app-ann-marker__remove"
        removeBtn.type = "button"
        removeBtn.setAttribute("aria-label", "Remove marker")
        removeBtn.innerHTML = "&minus;"
        removeBtn.addEventListener("click", function (e) {
          e.stopPropagation()
          var targetAnn = getAnnotation(ann.id)
          if (targetAnn && targetAnn.positions) {
            delete targetAnn.positions[lightboxViewKey]
            if (Object.keys(targetAnn.positions).length === 0) {
              var idx = annotations.findIndex(function (a) { return a.id === ann.id })
              if (idx !== -1) annotations.splice(idx, 1)
              if (activeAnnotationId === ann.id) activeAnnotationId = null
            }
          }
          renderMarkers()
          renderSidebar()
          renderLightboxMarkers()
          autoSave()
        })
        marker.appendChild(removeBtn)

        // Attach click handler for selecting annotation + drag support
        marker.addEventListener("click", function (e) {
          e.stopPropagation()
          activeAnnotationId = ann.id
          renderMarkers()
          renderSidebar()
          renderLightboxMarkers()
        })

        marker.addEventListener("mousedown", function (e) {
          e.stopPropagation()
          var dragAnnId = ann.id
          var dragEl = this

          if (activeAnnotationId !== dragAnnId) {
            activeAnnotationId = dragAnnId
            renderMarkers()
            renderSidebar()
            renderLightboxMarkers()
          }

          var hasDragged = false
          var startX = e.clientX
          var startY = e.clientY

          function onMove(moveEvent) {
            var moved = Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3
            if (moved && !hasDragged) {
              hasDragged = true
              dragEl.classList.add("dragging")
            }
            if (hasDragged) {
              var rect = lightboxPanel.getBoundingClientRect()
              dragEl.style.left = Math.max(0, Math.min(100, ((moveEvent.clientX - rect.left) / rect.width) * 100)) + "%"
              dragEl.style.top = Math.max(0, Math.min(100, ((moveEvent.clientY - rect.top) / rect.height) * 100)) + "%"
            }
          }

          function onUp(upEvent) {
            document.removeEventListener("mousemove", onMove)
            document.removeEventListener("mouseup", onUp)
            dragEl.classList.remove("dragging")

            if (hasDragged) {
              var rect = lightboxPanel.getBoundingClientRect()
              var cx = Math.max(0, Math.min(1, (upEvent.clientX - rect.left) / rect.width))
              var cy = Math.max(0, Math.min(1, (upEvent.clientY - rect.top) / rect.height))
              var imgPos = containerFractionToImageFraction(cx, cy, lightboxPanel)
              var dragAnn = getAnnotation(dragAnnId)
              if (dragAnn) {
                if (!dragAnn.positions) dragAnn.positions = {}
                dragAnn.positions[lightboxViewKey] = { x: Math.round(imgPos.x * 1000) / 1000, y: Math.round(imgPos.y * 1000) / 1000 }
              }
              renderMarkers()
              renderSidebar()
              renderLightboxMarkers()
              autoSave()
            }
          }

          document.addEventListener("mousemove", onMove)
          document.addEventListener("mouseup", onUp)
        })

        lightboxPanel.appendChild(marker)
      })
    }

    // Lightbox cursor preview
    var lightboxCursorPreview = document.createElement("div")
    lightboxCursorPreview.className = "app-ann-cursor-preview"
    lightboxCursorPreview.setAttribute("aria-hidden", "true")
    lightboxCursorPreview.hidden = true

    var lightboxCursorBadge = document.createElement("div")
    lightboxCursorBadge.className = "app-ann-cursor-preview__badge"
    lightboxCursorBadge.hidden = true
    lightboxCursorPreview.appendChild(lightboxCursorBadge)

    function onLightboxMouseMove(e) {
      if (e.target.closest(".app-ann-marker")) {
        hideLightboxPreview()
        return
      }
      if (lightboxCursorPreview.parentElement !== lightboxPanel) lightboxPanel.appendChild(lightboxCursorPreview)
      var rect = lightboxPanel.getBoundingClientRect()
      var x = ((e.clientX - rect.left) / rect.width) * 100
      var y = ((e.clientY - rect.top) / rect.height) * 100
      lightboxCursorPreview.style.left = x + "%"
      lightboxCursorPreview.style.top = y + "%"

      var displayIndex = buildDisplayIndices()
      var incompleteAnn = annotations.find(function (a) {
        return a.side === activeSide && !(a.abnormalityTypes && a.abnormalityTypes.length) && !a.levelOfConcern
      })
      if (incompleteAnn) {
        lightboxCursorBadge.textContent = "?"
      } else {
        var ann = activeAnnotationId ? getAnnotation(activeAnnotationId) : null
        if (ann && ann.side === activeSide && (!ann.positions || !ann.positions[lightboxViewKey])) {
          lightboxCursorBadge.textContent = displayIndex[ann.id] || "?"
        } else {
          lightboxCursorBadge.textContent = "+"
        }
      }
      lightboxCursorBadge.hidden = false
      lightboxCursorPreview.hidden = false
    }

    function hideLightboxPreview() {
      lightboxCursorPreview.hidden = true
      lightboxCursorBadge.hidden = true
    }

    function onLightboxClick(e) {
      if (e.target.closest(".app-ann-marker")) return
      if (!lightboxViewKey) return
      var rect = lightboxPanel.getBoundingClientRect()
      var cx = (e.clientX - rect.left) / rect.width
      var cy = (e.clientY - rect.top) / rect.height
      var imagePos = containerFractionToImageFraction(cx, cy, lightboxPanel)
      var x = Math.round(imagePos.x * 1000) / 1000
      var y = Math.round(imagePos.y * 1000) / 1000

      // Find or create the annotation to update
      var targetAnn = null
      var incompleteAnn = annotations.find(function (a) {
        return a.side === activeSide && !(a.abnormalityTypes && a.abnormalityTypes.length) && !a.levelOfConcern
      })
      if (incompleteAnn) {
        targetAnn = incompleteAnn
      } else if (activeAnnotationId) {
        var ann = getAnnotation(activeAnnotationId)
        if (ann && ann.side === activeSide) targetAnn = ann
      }

      if (!targetAnn) {
        var newId = uid()
        annotations.push({ id: newId, side: activeSide, positions: {}, annotationNumber: ++annotationCounter })
        activeAnnotationId = newId
        targetAnn = annotations[annotations.length - 1]
      }

      if (!targetAnn.positions) targetAnn.positions = {}
      targetAnn.positions[lightboxViewKey] = { x: x, y: y }
      activeAnnotationId = targetAnn.id

      renderLightboxMarkers()

      // Auto-close after a brief moment so user sees the placed marker
      setTimeout(function () {
        closeLightbox()
        renderMarkers()
        renderSidebar()

        // Open modal if all panels covered and annotation incomplete
        var updated = getAnnotation(targetAnn.id)
        if (updated && !(updated.abnormalityTypes && updated.abnormalityTypes.length) && !updated.levelOfConcern) {
          var panelKeys = getPanelKeysForSide(activeSide)
          if (panelKeys.length > 0 && panelKeys.every(function (k) { return updated.positions && updated.positions[k] })) {
            openModal(updated.id)
          }
        }
        autoSave()
      }, 300)
    }

    // Lightbox close handlers
    if (lightbox) {
      document.getElementById("ann-lightbox-close").addEventListener("click", closeLightbox)
      document.getElementById("ann-lightbox-overlay").addEventListener("click", closeLightbox)
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !lightbox.hidden) {
          e.stopPropagation()
          closeLightbox()
        }
      })
    }

    // ─── Bind interactive panels ─────────────────────────────────────────────

    function bindImagePanels() {
      var panels = container.querySelectorAll(
        '[data-panel-side="' + activeSide + '"] .app-annotation-images__panel:not(.app-annotation-images__panel--no-image)'
      )

      panels.forEach(function (panel) {
        if (panel.dataset.bound) return
        panel.dataset.bound = "true"

        panel.addEventListener("click", handleImageClick)
        panel.addEventListener("mouseenter", function () {
          placedThisHover.delete(this.dataset.view)
        })
        panel.addEventListener("mousemove", function (e) { updateCursorPreview(this, e) })
        panel.addEventListener("mouseleave", hideCursorPreview)

        panel.style.cursor = "crosshair"

        // Zoom button
        var zoomBtn = panel.querySelector(".app-annotation-images__zoom-btn")
        if (zoomBtn) {
          zoomBtn.addEventListener("click", function (e) {
            e.stopPropagation()
            openLightbox(panel)
          })
        }
      })
    }

    // ─── Wire up events ──────────────────────────────────────────────────────

    // Tab clicks
    container.querySelectorAll("[data-thumb-side]").forEach(function (tab) {
      tab.addEventListener("click", handleTabClick)
    })

    // Sidebar delegation
    container.addEventListener("click", function (e) {
      if (e.target.closest(".app-ann-v2__sidebar-scroll")) {
        handleSidebarClick(e)
      }
    })

    container.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return
      var card = e.target.closest(".app-annotation-list__card")
      if (!card || !card.dataset.annId) return
      e.preventDefault()
      activeAnnotationId = card.dataset.annId
      renderSidebar()
      renderMarkers()
    })

    // Modal events
    if (annModal) {
      document.getElementById("ann-modal-save").addEventListener("click", saveModal)
      document.getElementById("ann-modal-cancel").addEventListener("click", cancelModal)
      document.getElementById("ann-modal-delete").addEventListener("click", deleteModalAnnotation)
      document.getElementById("ann-modal-close-x").addEventListener("click", cancelModal)
      annModal.querySelector(".app-modal__overlay").addEventListener("click", cancelModal)

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !annModal.hidden) cancelModal()
      })
    }

    // Resize handler
    var resizeTimer
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(function () {
        renderMarkers()
      }, 100)
    })

    // ─── Initial render ──────────────────────────────────────────────────────

    bindImagePanels()

    // Clear server-rendered markers — JS will re-render with correct positions
    container.querySelectorAll(".app-ann-marker").forEach(function (m) { m.remove() })

    // Wait for images to load, then render markers
    var images = container.querySelectorAll("img")
    var loaded = 0
    var total = images.length

    function onImageLoad() {
      loaded++
      if (loaded >= total) renderMarkers()
    }

    images.forEach(function (img) {
      if (img.complete) onImageLoad()
      else img.addEventListener("load", onImageLoad, { once: true })
    })

    // Render sidebar and tabs (replaces server-rendered content)
    renderSidebar()
    renderTabs()
    if (total === 0) renderMarkers()

    // Return public API for this instance
    return {
      getAnnotations: function () { return annotations },
      switchSide: switchSide,
      renderMarkers: renderMarkers,
      renderSidebar: renderSidebar
    }
  }

  // ─── Static marker correction (for readonly pages) ─────────────────────────

  function correctAllMarkers() {
    var containers = document.querySelectorAll(".app-annotation-images")
    containers.forEach(function (cont) {
      cont.querySelectorAll(".app-ann-marker").forEach(function (marker) {
        if (!marker.dataset.posX) {
          marker.dataset.posX = parseFloat(marker.style.left) || 0
          marker.dataset.posY = parseFloat(marker.style.top) || 0
        }
      })

      var images = cont.querySelectorAll("img")
      var loaded = 0
      var total = images.length

      function onLoad() {
        loaded++
        if (loaded >= total) correctContainer(cont)
      }

      images.forEach(function (img) {
        if (img.complete) onLoad()
        else img.addEventListener("load", onLoad, { once: true })
      })
    })
  }

  function correctContainer(cont) {
    var panels = cont.querySelectorAll(
      ".app-annotation-images__panel:not(.app-annotation-images__panel--no-image)"
    )
    panels.forEach(function (panel) {
      panel.querySelectorAll(".app-ann-marker").forEach(function (marker) {
        var rawX = parseFloat(marker.dataset.posX) / 100
        var rawY = parseFloat(marker.dataset.posY) / 100
        if (isNaN(rawX) || isNaN(rawY)) return
        var corrected = imageFractionToContainerPercent({ x: rawX, y: rawY }, panel)
        marker.style.left = corrected.x + "%"
        marker.style.top = corrected.y + "%"
      })
    })
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  window.AnnotationMarkers = {
    init: init,
    correctAll: correctAllMarkers,
    getImageRect: getImageRect,
    imageFractionToContainerPercent: imageFractionToContainerPercent,
    containerFractionToImageFraction: containerFractionToImageFraction
  }
})()
