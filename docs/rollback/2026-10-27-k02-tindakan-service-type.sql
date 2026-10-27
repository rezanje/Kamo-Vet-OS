-- K02 follow-up (27 Oct 2026): clinic procedures typed as stock items lose their BMHP.
--
-- 108 active items under the TINDAKAN category tree were imported with item_type 'Persediaan'.
-- The clinic cart adds a non-Jasa SKU as a stock line, and K02 (guard_prescription_bmhp,
-- clinic_post_invoice) only stores and issues BMHP on Jasa service lines, so the composed
-- BMHP was dropped. Owner decision (Reza, 27 Oct 2026): retype pure service SKUs to 'Jasa'.
--
-- Scope: the 82 items below. Each was active, under TINDAKAN, item_type 'Persediaan',
-- not a compound material, and had no row in any stock, purchase, sale, invoice, prescription,
-- production, opname, transfer, compound or group table when checked on 27 Oct 2026.
-- Deliberately excluded (stay 'Persediaan'):
--   * 18 vaccines (physical vials that are purchased and stocked; Vaccine F4 and Vaccine Rabies
--     10Ds DF already carry stock and history),
--   * Obat Empedu (Urdflk), Obat Kumur Minosep 10Ml (medicines),
--   * Anestesi Inhalasi, Infus Iv, Tindakan Medis 1 Emergency (each has a saved prescription row),
--   * compound materials.
-- The UI change in the same PR adds stocked procedure SKUs straight to the cart as stock lines,
-- without the BMHP composer.
--
-- Items:
--   100184     Urinalisis Test
--   100315     Tumor Mamae Dog 10kg
--   100716     Xray New
--   100840     Pemeriksaan Gula Darah
--   J0006      Polip Telinga Hidung
--   J0009      Hematologi Bandung
--   J0014      Infus Iv Emergency
--   J0015      Infus Refill
--   J0016      Infus Sc
--   J0017      Infus Sc Emergency
--   J0018      Injeksi Antibiotik
--   J0019      Injeksi Antibiotik Emergency
--   J0020      Injeksi Multi Vitamin
--   J0021      Injeksi Multi Vitamin Emergency
--   J0022      Injeksi Multi Vitamin Garuda
--   J0023      Injeksi Non Antibiotik
--   J0024      Injeksi Non Antibiotik Emergency
--   J0025      Injeksi Obat Bius 2Kg
--   J0026      Injeksi Obat Bius 3Kg
--   J0027      Injeksi Obat Bius 4-5Kg
--   J0028      Injeksi Obat Bius 6-8Kg
--   J0029      Injeksi Obat Bius Emergency
--   J0046      Kimia Darah 11
--   J0047      Kimia Darah 11 X Hematologi
--   J0048      Kimia Darah 14
--   J0049      Kimia Darah 14 X Hematologi
--   J0050      Kimia Darah 16
--   J0051      Kimia Darah 16 X Hematologi
--   J0052      Kimia Darah 22
--   J0053      Kimia Darah 22 X Hematologi
--   J0056      Nebu
--   J0057      Nebu Paket A
--   J0113      Operasi Besar
--   J0114      Operasi Caesar
--   J0115      Operasi Caesar + Oh
--   J0116      Operasi Cystotomi
--   J0117      Operasi Fraktur Mandibula 1
--   J0118      Operasi Fraktur Mandibula 2
--   J0119      Operasi Fraktur Mandibula 3
--   J0120      Operasi Hernia Abdominalis
--   J0121      Operasi Mata ( Entripion)
--   J0122      Operasi Mata ( Enukleasi)
--   J0123      Operasi Monorchid
--   J0124      Operasi Orthopedi
--   J0125      Operasi Othematom
--   J0126      Operasi Pyometra
--   J0127      Operasi Tumor Besar (>6 Cm)
--   J0128      Operasi Tumor Kecil (< 3 Cm)
--   J0129      Operasi Tumor Mamae Kucing (Bb >5Kg)
--   J0130      Operasi Tumor Mamae Kucing (Bb 2-5Kg)
--   J0131      Operasi Tumor Sedang (3-6 Cm)
--   J0132      Pasang Kateter
--   J0133      Pasang Kateter Emergency
--   J0134      Pemerikasan Mikroskopis
--   J0135      Pemerikasan Mikroskopis Emergency
--   J0136      Pemeriksaan Ophtalmoscope+Otoscope
--   J0137      Pemeriksaan Ophtalmoscope+Otoscope Emergency
--   J0138      Pengambilan dan pemeriksaan sampel endoparasit & ektoparasit
--   J0177      Skin Flapping
--   J0180      Test Rivalta
--   J0183      Operasi Amputasi Kecil Ekor
--   J0184      Operasi Amputasi Kecil Kaki
--   J0185      Tindakan Ftm ( Mata)
--   J0186      Tindakan Ftm ( Mata) Emergency
--   J0187      Tindakan Lahiran Normal (Per 1 Anak)
--   J0188      Tindakan Medis 1
--   J0190      Tindakan Medis 2
--   J0191      Tindakan Medis 2 Emergency
--   J0192      Tindakan Medis 3
--   J0193      Tindakan Medis 3 Emergency
--   J0194      Tindakan Medis 4
--   J0195      Tindakan Medis 4 Emergency
--   J0196      Tindakan Medis 5
--   J0197      Tindakan Medis 5 Emergency
--   J0198      Tindakan Prolaps Anus
--   J0199      Tindakan Prolaps Emergency Anus
--   J0200      Tindakan Prolaps Emergency Uteri
--   J0201      Tindakan Prolaps Uteri
--   J0204      Ulas Darah Emergency
--   J0216      Injeksi Multi Vitamin TKI
--   J08        Tindakan Medis
--   uka44      Ulas Darah

-- Forward (applied once on production). The guards re-check that nothing references the item.
update public.items i set item_type = 'Jasa'
where i.id = any(array[
    '5b79f0ea-b3e6-4a28-bd21-dc523084253b',
    'bfeb954b-370c-4ff2-a7cc-d871b4f655c9',
    'ace3243e-d610-4b74-bc8d-26f32e83197a',
    'b995e362-288f-4212-96c5-7d301aba477d',
    '47eda538-17fb-4428-999b-165abbfd7d33',
    '2415090a-2fdf-4959-9546-c948ae30d811',
    'bb88357a-8a6e-4fd0-ab12-dc8ca0aae9b8',
    '09297f1b-7f3e-4052-80fd-eaaece1f1364',
    'b3b68337-3a0f-44fa-9ada-c9ad793a31a1',
    '5b5cee57-7119-49ca-9009-a4f181dc1e23',
    '7a42587e-3f27-4e2b-bfac-27c516c8eadc',
    'ab0f5d99-358c-4ce1-9d67-aa199f8d00b6',
    'dad15f30-7c8d-40da-a402-157fb9cbf1a1',
    '50f73146-443b-4940-8484-324ff7145d67',
    '58b1388e-993a-444b-b1df-a6a448b227da',
    'c8e3b100-2865-4847-b238-9c1316420de7',
    'baa9c12a-6fd2-4f15-ab69-b6137c20408d',
    '1697b955-844f-4d78-9fd9-47c4021706cb',
    '32d6ac4f-6ef5-488f-ae89-ccd14674004f',
    '7a685bcd-9275-4465-bb4c-1dbdae1027be',
    '682ccbb1-5739-4231-a98f-aa727df64f65',
    '79542f50-94b2-48fc-aaee-22944e740975',
    'cccff1e3-4325-405d-8012-1699bbae53f3',
    'a39d181a-3bfd-4cf5-969c-3d20276b6338',
    '0b0435a5-c52e-4d36-87aa-269ef4c7ce42',
    '27b1727e-1841-4462-bd6d-522481cab013',
    'b0849dda-24eb-4a72-9340-621c61bc066a',
    '92c7f911-b861-4a85-a2a9-775063964d58',
    'aa6e8842-4f49-4e57-8f5b-264adecbccce',
    'bbfbfbbc-1800-4810-8ea2-30ee9358323e',
    'e3ecf4d4-a877-4d71-b5b9-f67bfb13d456',
    '86b2b66c-96be-44b3-9754-d6997800e7bb',
    '7510716e-954a-4411-9693-0164f3a12b74',
    '435d62e7-164b-48b1-b853-57bb9eb72a86',
    '1964766c-4877-4e61-b3d6-d2c95530bc52',
    'd7c234ba-09f4-4e14-947c-f22887f26b23',
    '21df14c7-9149-439b-98ed-3ea212740f01',
    'cb72dfa7-3ed4-4b18-b29e-8a7ba7cbbbd4',
    'd2e66d9f-4a84-462d-b8a0-817c3444b929',
    '4df9c928-e9e5-4be8-a26c-780281e2c0db',
    'c842b32e-556b-45b3-8009-c5df7c113744',
    'bf15a800-e226-40e9-9dab-706936cc8bb2',
    '73cb2faf-7ce5-41af-9fca-40423e16ebaf',
    'b71bfcee-308a-4b0c-8547-52df65652561',
    '0f9f7b61-d043-4c23-b336-ba0db3376e80',
    '69c7ad60-b909-48c1-ae4b-304e405cc464',
    'd81a71b8-e7f9-4c58-ad0b-3658dd434127',
    'b334a33c-5d93-4f58-b5eb-82bfcb4935fe',
    '68940dd7-3abd-45cc-8881-1e278ffcad51',
    'be7a021c-27cb-4fcf-b84f-38f930614dfa',
    'd5575cee-cb07-45be-b104-fcc0ba0ad80b',
    '6c70c797-b926-46b4-83b2-699fd330e818',
    '8e3eb232-7a10-4536-98af-789551ac34b9',
    'f3beac05-3b55-4a1b-842d-5de26f7cfcb2',
    'cd8e4cdb-f063-419e-93b2-fbbf3b633a88',
    'accba033-8cbe-41c1-a7cc-addb494de13d',
    '85c8401e-73d2-41f8-a6a8-70b5d21884cb',
    'c3609ef7-aa47-4bdc-9bed-059b0b112889',
    '4fb86e35-3f5d-43d1-962b-1405f1bdbc79',
    'bdce97d5-cf1e-4b16-8ec4-435bc75ca94a',
    'ba46ac32-0302-4368-ad8a-9bfadb085bc4',
    '5d3f161d-ae62-4b70-9297-a0603d8dc651',
    'c7b82221-1b60-4893-a17e-aad34baf5a66',
    '5697a97f-bcfa-401f-926f-145b993e05a0',
    '64e9e481-843b-4b22-b1f4-540eb8a67131',
    '8ea3b7b4-d3f4-44fa-b781-3a3d5c85c4cf',
    '08c3c97a-f8b9-4a84-bc52-023f0a264004',
    'ee116d82-40fc-4d17-a9b0-537444cc245d',
    '7a09bfb6-2926-4db3-b25d-3b3f7366c404',
    '8aca78ec-c363-41d6-9708-217c107026a8',
    '312c477e-d048-4ddd-b053-532ade797165',
    '6f9429f9-1bc8-454f-a642-f9996bf5912c',
    '62c1a044-bbfb-43e3-8719-9b394040e3b1',
    '0ca0a6bb-8bd1-4fc1-ae5f-e39664d2dc66',
    '2b80d2bc-8a21-42bb-b876-e42df04ae4d1',
    '068607b6-e148-4f87-a23e-b701a30da54a',
    '514312fe-75f5-479a-9d9f-c1f603bafc1a',
    '5f76a1cc-ee1d-4411-955c-b36ead067d50',
    '351d8dd3-b902-4416-bd2f-7197ba4be3f4',
    '91849055-9ef7-4bdb-a93f-e72af5e5a5f8',
    '719e9a04-c66a-4d14-be55-d1f571881deb',
    'fd3a4a2c-051f-4f72-ac62-afbb7da06e18'
  ]::uuid[])
  and i.item_type = 'Persediaan'
  and not exists (select 1 from public.stock s where s.item_id = i.id)
  and not exists (select 1 from public.stock_moves m where m.item_id = i.id)
  and not exists (select 1 from public.stock_layers l where l.item_id = i.id)
  and not exists (select 1 from public.prescription_items p where p.item_id = i.id)
  and not exists (select 1 from public.invoice_items v where v.item_id = i.id)
  and not exists (select 1 from public.sale_items x where x.item_id = i.id);

-- Rollback (only valid while the items have not been used as Jasa lines):
-- update public.items set item_type = 'Persediaan'
-- where item_type = 'Jasa' and id = any(array[ ...same ids... ]::uuid[]);
