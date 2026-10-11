# Opens the generated report in Microsoft Word, refreshes the table of contents and the
# lists of figures/tables, saves it, and exports a PDF next to it.
param(
  [Parameter(Mandatory = $true)][string]$Docx
)
$Docx = (Resolve-Path $Docx).Path
$Pdf = [System.IO.Path]::ChangeExtension($Docx, ".pdf")
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Docx, $false, $false, $false)
  # Two passes: page numbers settle after the TOC itself has been filled.
  for ($pass = 0; $pass -lt 2; $pass++) {
    foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
    $doc.Fields.Update() | Out-Null
  }
  # Turn off the "update fields on open" prompt now that fields are current.
  $doc.Save()
  $doc.ExportAsFixedFormat($Pdf, 17)  # wdExportFormatPDF
  $pages = $doc.ComputeStatistics(2)   # wdStatisticPages
  $words = $doc.ComputeStatistics(0)   # wdStatisticWords
  $doc.Close($false)
  Write-Output "pages=$pages words=$words pdf=$Pdf"
}
finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
