; Default the assisted installer to the ASCII DeepagensWork directory under
; Program Files: the OEM display name (深度Work) stays user-facing while the
; on-disk install path stays stable across OEM display-name renames.
!macro customInit
  StrCpy $INSTDIR "$PROGRAMFILES64\DeepagensWork"
!macroend
