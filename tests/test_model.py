import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build import organize
class Records(unittest.TestCase):
 def test_duplicate_keeps_richest_source_without_guessing_coordinates(self):
  row={'PLACE_ID':'1','MAIN_NAME_EN':'Test mill','PL_PROV_TERR':'British Columbia','DESC_HIST_EN':'Industrial mill'}
  records,details=organize([row,{**row,'DESC_HIST_EN':'A longer industrial mill history'}])
  self.assertEqual(len(records),1);self.assertEqual(details['1']['description'],'A longer industrial mill history');self.assertNotIn('coordinates',records[0])
 def test_theme_matches_wording_and_empty_sources_fail(self):
  records,_=organize([{'PLACE_ID':'2','MAIN_NAME_EN':'Test site','DESC_HIST_EN':'A former company town.'}])
  self.assertIn('settlements',records[0]['evidence'])
  with self.assertRaises(ValueError):organize([])
