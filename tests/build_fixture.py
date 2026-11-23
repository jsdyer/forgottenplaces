import tempfile,sys
from pathlib import Path
from openpyxl import Workbook
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build import build
with tempfile.TemporaryDirectory() as temp:
 path=Path(temp)/'test.xlsx';wb=Workbook();sheet=wb.active
 sheet.append(['PLACE_ID','MAIN_NAME_EN','MAIN_NAME_FR','PL_PROV_TERR','MAIN_REC_TYPE','DESC_HIST_EN'])
 for i in range(100):sheet.append([str(i),'Test heritage mill '+str(i),'Moulin test','British Columbia','Test designation','A former industrial mill.'])
 wb.save(path)
 build(path,{'downloadUrl':'https://example.org/test.xlsx','extractDate':'2026-01-01','resourceDate':'2026-01-01'},ROOT/'dist')
