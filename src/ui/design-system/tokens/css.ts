/**
 * @file css.ts
 * @description Global CSS custom properties (variables) definition - Radix Standards
 */

const lightModeTokens = `
  :root {
    /* --- Radix Scales (Generated) --- */
    /* Gray (Neutral) - Light Mode */
    --gray-1: #fcfcfc;
    --gray-2: #f9f9f9;
    --gray-3: #f0f0f0;
    --gray-4: #e8e8e8;
    --gray-5: #e0e0e0;
    --gray-6: #d9d9d9;
    --gray-7: #cecece;
    --gray-8: #bbbbbb;
    --gray-9: #8d8d8d;
    --gray-10: #838383;
    --gray-11: #646464;
    --gray-12: #171717;

    --gray-a1: rgba(0, 0, 0, 0.012);
    --gray-a2: rgba(0, 0, 0, 0.024);
    --gray-a3: rgba(0, 0, 0, 0.059);
    --gray-a4: rgba(0, 0, 0, 0.09);
    --gray-a5: rgba(0, 0, 0, 0.118);
    --gray-a6: rgba(0, 0, 0, 0.149);
    --gray-a7: rgba(0, 0, 0, 0.192);
    --gray-a8: rgba(0, 0, 0, 0.267);
    --gray-a9: rgba(0, 0, 0, 0.447);
    --gray-a10: rgba(0, 0, 0, 0.486);
    --gray-a11: rgba(0, 0, 0, 0.608);
    --gray-a12: rgba(0, 0, 0, 0.875);

    /* Amber */
    --amber-1: #FEFDFB;
    --amber-2: #FEFBE9;
    --amber-3: #FFF7C2;
    --amber-4: #FFEE9C;
    --amber-5: #FBE577;
    --amber-6: #F3D673;
    --amber-7: #E9C162;
    --amber-8: #E2A336;
    --amber-9: #FFC53D;
    --amber-10: #FFBA18;
    --amber-11: #AB6400;
    --amber-12: #4F3422;
    --amber-a1: rgba(192, 128, 0, 0.016);
    --amber-a2: rgba(244, 209, 0, 0.086);
    --amber-a3: rgba(255, 222, 0, 0.239);
    --amber-a4: rgba(255, 212, 0, 0.388);
    --amber-a5: rgba(248, 207, 0, 0.533);
    --amber-a6: rgba(234, 181, 0, 0.549);
    --amber-a7: rgba(220, 155, 0, 0.616);
    --amber-a8: rgba(218, 138, 0, 0.788);
    --amber-a9: rgba(255, 179, 0, 0.761);
    --amber-a10: rgba(255, 179, 0, 0.906);
    --amber-a11: #AB6400;
    --amber-a12: rgba(52, 21, 0, 0.867);

    /* Blue */
    --blue-1: #FBFDFF;
    --blue-2: #F4FAFF;
    --blue-3: #E6F4FE;
    --blue-4: #D5EFFF;
    --blue-5: #C2E5FF;
    --blue-6: #ACD8FC;
    --blue-7: #8EC8F6;
    --blue-8: #5EB1EF;
    --blue-9: #0090FF;
    --blue-10: #0588F0;
    --blue-11: #0D74CE;
    --blue-12: #113264;
    --blue-a1: rgba(0, 128, 255, 0.016);
    --blue-a2: rgba(0, 140, 255, 0.043);
    --blue-a3: rgba(0, 143, 245, 0.098);
    --blue-a4: rgba(0, 158, 255, 0.165);
    --blue-a5: rgba(0, 147, 255, 0.239);
    --blue-a6: rgba(0, 136, 246, 0.325);
    --blue-a7: rgba(0, 131, 235, 0.443);
    --blue-a8: rgba(0, 132, 230, 0.631);
    --blue-a9: #0090FF;
    --blue-a10: rgba(0, 134, 240, 0.98);
    --blue-a11: rgba(0, 109, 203, 0.949);
    --blue-a12: rgba(91, 92, 93, 0.933);

    /* Bronze */
    --bronze-1: #FDFCFC;
    --bronze-2: #FDF7F5;
    --bronze-3: #F6EDEA;
    --bronze-4: #EFE4DF;
    --bronze-5: #E7D9D3;
    --bronze-6: #DFCDC5;
    --bronze-7: #D3BCB3;
    --bronze-8: #C2A499;
    --bronze-9: #A18072;
    --bronze-10: #957468;
    --bronze-11: #7D5E54;
    --bronze-12: #43302B;
    --bronze-a1: rgba(85, 0, 0, 0.012);
    --bronze-a2: rgba(204, 51, 0, 0.039);
    --bronze-a3: rgba(146, 37, 0, 0.082);
    --bronze-a4: rgba(128, 40, 0, 0.125);
    --bronze-a5: rgba(116, 35, 0, 0.173);
    --bronze-a6: rgba(115, 36, 0, 0.227);
    --bronze-a7: rgba(108, 31, 0, 0.298);
    --bronze-a8: rgba(103, 28, 0, 0.4);
    --bronze-a9: rgba(85, 26, 0, 0.553);
    --bronze-a10: rgba(76, 21, 0, 0.592);
    --bronze-a11: rgba(61, 15, 0, 0.671);
    --bronze-a12: rgba(29, 6, 0, 0.831);

    /* Brown */
    --brown-1: #FEFDFC;
    --brown-2: #FCF9F6;
    --brown-3: #F6EEE7;
    --brown-4: #F0E4D9;
    --brown-5: #EBDACA;
    --brown-6: #E4CDB7;
    --brown-7: #DCBC9F;
    --brown-8: #CEA37E;
    --brown-9: #AD7F58;
    --brown-10: #A07553;
    --brown-11: #815E46;
    --brown-12: #3E332E;
    --brown-a1: rgba(170, 85, 0, 0.012);
    --brown-a2: rgba(170, 85, 0, 0.035);
    --brown-a3: rgba(160, 75, 0, 0.094);
    --brown-a4: rgba(155, 74, 0, 0.149);
    --brown-a5: rgba(159, 77, 0, 0.208);
    --brown-a6: rgba(160, 78, 0, 0.282);
    --brown-a7: rgba(163, 78, 0, 0.376);
    --brown-a8: rgba(159, 74, 0, 0.506);
    --brown-a9: rgba(130, 60, 0, 0.655);
    --brown-a10: rgba(114, 51, 0, 0.675);
    --brown-a11: rgba(82, 33, 0, 0.725);
    --brown-a12: rgba(20, 6, 0, 0.82);

    /* Crimson */
    --crimson-1: #FFFCFD;
    --crimson-2: #FEF7F9;
    --crimson-3: #FFE9F0;
    --crimson-4: #FEDCE7;
    --crimson-5: #FACEDD;
    --crimson-6: #F3BED1;
    --crimson-7: #EAACC3;
    --crimson-8: #E093B2;
    --crimson-9: #E93D82;
    --crimson-10: #DF3478;
    --crimson-11: #CB1D63;
    --crimson-12: #621639;
    --crimson-a1: rgba(255, 0, 85, 0.012);
    --crimson-a2: rgba(224, 0, 64, 0.031);
    --crimson-a3: rgba(255, 0, 82, 0.086);
    --crimson-a4: rgba(248, 0, 81, 0.137);
    --crimson-a5: rgba(229, 0, 79, 0.192);
    --crimson-a6: rgba(208, 0, 75, 0.255);
    --crimson-a7: rgba(191, 0, 71, 0.325);
    --crimson-a8: rgba(182, 0, 74, 0.424);
    --crimson-a9: rgba(226, 0, 91, 0.761);
    --crimson-a10: rgba(215, 0, 86, 0.796);
    --crimson-a11: rgba(196, 0, 79, 0.886);
    --crimson-a12: rgba(83, 0, 38, 0.914);

    /* Custom */
    --custom-1: #FCFCFC;
    --custom-2: #F9F9F9;
    --custom-3: #F0F0F0;
    --custom-4: #E8E8E8;
    --custom-5: #E1E1E1;
    --custom-6: #D9D9D9;
    --custom-7: #CECECE;
    --custom-8: #BBBBBB;
    --custom-9: #000000;
    --custom-10: #2E2E2E;
    --custom-11: #646464;
    --custom-12: #202020;
    --custom-a1: rgba(0, 0, 0, 0.012);
    --custom-a2: rgba(0, 0, 0, 0.024);
    --custom-a3: rgba(0, 0, 0, 0.059);
    --custom-a4: rgba(0, 0, 0, 0.09);
    --custom-a5: rgba(0, 0, 0, 0.118);
    --custom-a6: rgba(0, 0, 0, 0.149);
    --custom-a7: rgba(0, 0, 0, 0.192);
    --custom-a8: rgba(0, 0, 0, 0.267);
    --custom-a9: #000000;
    --custom-a10: rgba(0, 0, 0, 0.82);
    --custom-a11: rgba(0, 0, 0, 0.608);
    --custom-a12: rgba(0, 0, 0, 0.875);

    /* --- Component Specific (Semantic) --- */
    --header-height: 52px;
    --header-bg: var(--colors-surface);
    --header-border: var(--colors-gray-border);
    
    /* Success / Green */
    --success-1: var(--green-1);
    --success-2: var(--green-2);
    --success-3: var(--green-3);
    --success-4: var(--green-4);
    --success-5: var(--green-5);
    --success-6: var(--green-6);
    --success-7: var(--green-7);
    --success-8: var(--green-8);
    --success-9: var(--green-9);
    --success-10: var(--green-10);
    --success-11: var(--green-11);
    --success-12: var(--green-12);
    --success-a1: var(--green-a1);
    --success-a2: var(--green-a2);
    --success-a3: var(--green-a3);
    --success-a4: var(--green-a4);
    --success-a5: var(--green-a5);
    --success-a6: var(--green-a6);
    --success-a7: var(--green-a7);
    --success-a8: var(--green-a8);
    --success-a9: var(--green-a9);
    --success-a10: var(--green-a10);
    --success-a11: var(--green-a11);
    --success-a12: var(--green-a12);

    /* Error / Crimson (using Crimson as base for Error as per Radix recommendation) */
    --error-1: var(--crimson-1);
    --error-2: var(--crimson-2);
    --error-3: var(--crimson-3);
    --error-4: var(--crimson-4);
    --error-5: var(--crimson-5);
    --error-6: var(--crimson-6);
    --error-7: var(--crimson-7);
    --error-8: var(--crimson-8);
    --error-9: var(--crimson-9);
    --error-10: var(--crimson-10);
    --error-11: var(--crimson-11);
    --error-12: var(--crimson-12);
    --error-a1: var(--crimson-a1);
    --error-a2: var(--crimson-a2);
    --error-a3: var(--crimson-a3);
    --error-a4: var(--crimson-a4);
    --error-a5: var(--crimson-a5);
    --error-a6: var(--crimson-a6);
    --error-a7: var(--crimson-a7);
    --error-a8: var(--crimson-a8);
    --error-a9: var(--crimson-a9);
    --error-a10: var(--crimson-a10);
    --error-a11: var(--crimson-a11);
    --error-a12: var(--crimson-a12);

    /* Warning / Amber */
    --warning-1: var(--amber-1);
    --warning-2: var(--amber-2);
    --warning-3: var(--amber-3);
    --warning-4: var(--amber-4);
    --warning-5: var(--amber-5);
    --warning-6: var(--amber-6);
    --warning-7: var(--amber-7);
    --warning-8: var(--amber-8);
    --warning-9: var(--amber-9);
    --warning-10: var(--amber-10);
    --warning-11: var(--amber-11);
    --warning-12: var(--amber-12);
    --warning-a1: var(--amber-a1);
    --warning-a2: var(--amber-a2);
    --warning-a3: var(--amber-a3);
    --warning-a4: var(--amber-a4);
    --warning-a5: var(--amber-a5);
    --warning-a6: var(--amber-a6);
    --warning-a7: var(--amber-a7);
    --warning-a8: var(--amber-a8);
    --warning-a9: var(--amber-a9);
    --warning-a10: var(--amber-a10);
    --warning-a11: var(--amber-a11);
    --warning-a12: var(--amber-a12);

    /* Cyan */
    --cyan-1: #FAFDFE;
    --cyan-2: #F2FAFB;
    --cyan-3: #DEF7F9;
    --cyan-4: #CAF1F6;
    --cyan-5: #B5E9F0;
    --cyan-6: #9DDDE7;
    --cyan-7: #7DCEDC;
    --cyan-8: #3DB9CF;
    --cyan-9: #00A2C7;
    --cyan-10: #0797B9;
    --cyan-11: #107D98;
    --cyan-12: #0D3C48;
    --cyan-a1: rgba(0, 153, 204, 0.02);
    --cyan-a2: rgba(0, 157, 177, 0.051);
    --cyan-a3: rgba(0, 194, 209, 0.129);
    --cyan-a4: rgba(0, 188, 212, 0.208);
    --cyan-a5: rgba(1, 180, 204, 0.29);
    --cyan-a6: rgba(0, 167, 193, 0.384);
    --cyan-a7: rgba(0, 159, 187, 0.51);
    --cyan-a8: rgba(0, 163, 192, 0.761);
    --cyan-a9: #00A2C7;
    --cyan-a10: rgba(0, 148, 183, 0.973);
    --cyan-a11: rgba(0, 116, 145, 0.937);
    --cyan-a12: rgba(0, 50, 62, 0.949);

    /* Gold */
    --gold-1: #FDFDFC;
    --gold-2: #FAF9F2;
    --gold-3: #F2F0E7;
    --gold-4: #EAE6DB;
    --gold-5: #E1DCCF;
    --gold-6: #D8D0BF;
    --gold-7: #CBC0AA;
    --gold-8: #B9A88D;
    --gold-9: #978365;
    --gold-10: #8C7A5E;
    --gold-11: #71624B;
    --gold-12: #3B352B;
    --gold-a1: rgba(85, 85, 0, 0.012);
    --gold-a2: rgba(157, 138, 0, 0.051);
    --gold-a3: rgba(117, 96, 0, 0.094);
    --gold-a4: rgba(107, 78, 0, 0.141);
    --gold-a5: rgba(96, 70, 0, 0.188);
    --gold-a6: rgba(100, 68, 0, 0.251);
    --gold-a7: rgba(99, 66, 0, 0.333);
    --gold-a8: rgba(99, 61, 0, 0.447);
    --gold-a9: rgba(83, 50, 0, 0.604);
    --gold-a10: rgba(73, 45, 0, 0.631);
    --gold-a11: rgba(54, 33, 0, 0.706);
    --gold-a12: rgba(19, 12, 0, 0.831);

    /* Grass */
    --grass-1: #FBFEFB;
    --grass-2: #F5FBF5;
    --grass-3: #E9F6E9;
    --grass-4: #DAF1DB;
    --grass-5: #C9E8CA;
    --grass-6: #B2DDB5;
    --grass-7: #94CE9A;
    --grass-8: #65BA74;
    --grass-9: #46A758;
    --grass-10: #3E9B4F;
    --grass-11: #2A7E3B;
    --grass-12: #203C25;
    --grass-a1: rgba(0, 192, 0, 0.016);
    --grass-a2: rgba(0, 153, 0, 0.039);
    --grass-a3: rgba(0, 151, 0, 0.086);
    --grass-a4: rgba(0, 159, 7, 0.145);
    --grass-a5: rgba(0, 147, 5, 0.212);
    --grass-a6: rgba(0, 143, 10, 0.302);
    --grass-a7: rgba(1, 139, 15, 0.42);
    --grass-a8: rgba(0, 141, 25, 0.604);
    --grass-a9: rgba(0, 134, 25, 0.725);
    --grass-a10: rgba(0, 123, 23, 0.757);
    --grass-a11: rgba(0, 101, 20, 0.835);
    --grass-a12: rgba(0, 32, 6, 0.875);

    /* Green */
    --green-1: #FBFEFC;
    --green-2: #F4FBF6;
    --green-3: #E6F6EB;
    --green-4: #D6F1DF;
    --green-5: #C4E8D1;
    --green-6: #ADDDC0;
    --green-7: #8ECEAA;
    --green-8: #5BB98B;
    --green-9: #30A46C;
    --green-10: #2B9A66;
    --green-11: #218358;
    --green-12: #193B2D;
    --green-a1: rgba(0, 192, 64, 0.016);
    --green-a2: rgba(0, 163, 47, 0.043);
    --green-a3: rgba(0, 164, 51, 0.098);
    --green-a4: rgba(0, 168, 56, 0.161);
    --green-a5: rgba(1, 156, 57, 0.231);
    --green-a6: rgba(0, 150, 60, 0.322);
    --green-a7: rgba(0, 145, 64, 0.443);
    --green-a8: rgba(0, 146, 75, 0.643);
    --green-a9: rgba(0, 143, 74, 0.812);
    --green-a10: rgba(0, 134, 71, 0.831);
    --green-a11: rgba(0, 113, 63, 0.871);
    --green-a12: rgba(0, 38, 22, 0.902);

    /* Indigo */
    --indigo-1: #FDFDFE;
    --indigo-2: #F7F9FF;
    --indigo-3: #EDF2FE;
    --indigo-4: #E1E9FF;
    --indigo-5: #D2DEFF;
    --indigo-6: #C1D0FF;
    --indigo-7: #ABBDF9;
    --indigo-8: #8DA4EF;
    --indigo-9: #3E63DD;
    --indigo-10: #3358D4;
    --indigo-11: #3A5BC7;
    --indigo-12: #1F2D5C;
    --indigo-a1: rgba(0, 0, 128, 0.008);
    --indigo-a2: rgba(0, 64, 255, 0.031);
    --indigo-a3: rgba(0, 71, 241, 0.071);
    --indigo-a4: rgba(0, 68, 255, 0.118);
    --indigo-a5: rgba(0, 68, 255, 0.176);
    --indigo-a6: rgba(0, 62, 255, 0.243);
    --indigo-a7: rgba(0, 55, 237, 0.329);
    --indigo-a8: rgba(0, 52, 220, 0.447);
    --indigo-a9: rgba(0, 49, 210, 0.757);
    --indigo-a10: rgba(0, 46, 201, 0.8);
    --indigo-a11: rgba(0, 43, 183, 0.773);
    --indigo-a12: rgba(0, 16, 70, 0.878);

    /* Iris */
    --iris-1: #FDFDFF;
    --iris-2: #F8F8FF;
    --iris-3: #F0F1FE;
    --iris-4: #E6E7FF;
    --iris-5: #DADCFF;
    --iris-6: #CBCDFF;
    --iris-7: #B8BAF8;
    --iris-8: #9B9EF0;
    --iris-9: #5B5BD6;
    --iris-10: #5151CD;
    --iris-11: #5753C6;
    --iris-12: #272962;
    --iris-a1: rgba(0, 0, 255, 0.008);
    --iris-a2: rgba(0, 0, 255, 0.027);
    --iris-a3: rgba(0, 17, 238, 0.059);
    --iris-a4: rgba(0, 11, 255, 0.098);
    --iris-a5: rgba(0, 14, 255, 0.145);
    --iris-a6: rgba(0, 10, 255, 0.204);
    --iris-a7: rgba(0, 8, 230, 0.278);
    --iris-a8: rgba(0, 8, 217, 0.392);
    --iris-a9: rgba(0, 0, 192, 0.643);
    --iris-a10: rgba(0, 0, 182, 0.682);
    --iris-a11: rgba(6, 0, 171, 0.675);
    --iris-a12: rgba(0, 2, 70, 0.847);

    /* Jade */
    --jade-1: #FBFEFD;
    --jade-2: #F4FBF7;
    --jade-3: #E6F7ED;
    --jade-4: #D6F1E3;
    --jade-5: #C3E9D7;
    --jade-6: #ACDEC8;
    --jade-7: #8BCEB6;
    --jade-8: #56BA9F;
    --jade-9: #29A383;
    --jade-10: #26997B;
    --jade-11: #208368;
    --jade-12: #1D3B31;
    --jade-a1: rgba(0, 192, 128, 0.016);
    --jade-a2: rgba(0, 163, 70, 0.043);
    --jade-a3: rgba(0, 174, 72, 0.098);
    --jade-a4: rgba(0, 168, 81, 0.161);
    --jade-a5: rgba(0, 162, 85, 0.235);
    --jade-a6: rgba(0, 154, 87, 0.325);
    --jade-a7: rgba(0, 148, 95, 0.455);
    --jade-a8: rgba(0, 151, 110, 0.663);
    --jade-a9: rgba(0, 145, 107, 0.839);
    --jade-a10: rgba(0, 135, 100, 0.851);
    --jade-a11: rgba(0, 113, 82, 0.875);
    --jade-a12: rgba(0, 34, 23, 0.886);

    /* Lime */
    --lime-1: #FCFDFA;
    --lime-2: #F8FAF3;
    --lime-3: #EEF6D6;
    --lime-4: #E2F0BD;
    --lime-5: #D3E7A6;
    --lime-6: #C2DA91;
    --lime-7: #ABC978;
    --lime-8: #8DB654;
    --lime-9: #BDEE63;
    --lime-10: #B0E64C;
    --lime-11: #5C7C2F;
    --lime-12: #37401C;
    --lime-a1: rgba(102, 153, 0, 0.02);
    --lime-a2: rgba(107, 149, 0, 0.047);
    --lime-a3: rgba(150, 200, 0, 0.161);
    --lime-a4: rgba(143, 198, 0, 0.259);
    --lime-a5: rgba(129, 187, 0, 0.349);
    --lime-a6: rgba(114, 170, 0, 0.431);
    --lime-a7: rgba(97, 153, 0, 0.529);
    --lime-a8: rgba(85, 146, 0, 0.671);
    --lime-a9: rgba(147, 228, 0, 0.612);
    --lime-a10: rgba(143, 220, 0, 0.702);
    --lime-a11: rgba(55, 95, 0, 0.816);
    --lime-a12: rgba(30, 41, 0, 0.89);

    /* Mauve */
    --mauve-1: #FDFCFD;
    --mauve-2: #FAF9FB;
    --mauve-3: #F2EFF3;
    --mauve-4: #EAE7EC;
    --mauve-5: #E3DFE6;
    --mauve-6: #DBD8E0;
    --mauve-7: #D0CDD7;
    --mauve-8: #BCBAC7;
    --mauve-9: #8E8C99;
    --mauve-10: #84828E;
    --mauve-11: #65636D;
    --mauve-12: #211F26;
    --mauve-a1: rgba(85, 0, 85, 0.012);
    --mauve-a2: rgba(43, 0, 85, 0.024);
    --mauve-a3: rgba(48, 0, 64, 0.063);
    --mauve-a4: rgba(32, 0, 54, 0.094);
    --mauve-a5: rgba(32, 0, 56, 0.125);
    --mauve-a6: rgba(20, 0, 53, 0.153);
    --mauve-a7: rgba(16, 0, 51, 0.196);
    --mauve-a8: rgba(8, 0, 49, 0.271);
    --mauve-a9: rgba(5, 0, 29, 0.451);
    --mauve-a10: rgba(5, 0, 25, 0.49);
    --mauve-a11: rgba(4, 0, 17, 0.612);
    --mauve-a12: rgba(2, 0, 8, 0.878);

    /* Mint */
    --mint-1: #F9FEFD;
    --mint-2: #F2FBF9;
    --mint-3: #DDF9F2;
    --mint-4: #C8F4E9;
    --mint-5: #B3ECDE;
    --mint-6: #9CE0D0;
    --mint-7: #7ECFBD;
    --mint-8: #4CBBA5;
    --mint-9: #86EAD4;
    --mint-10: #7DE0CB;
    --mint-11: #027864;
    --mint-12: #16433C;
    --mint-a1: rgba(0, 213, 170, 0.024);
    --mint-a2: rgba(0, 177, 138, 0.051);
    --mint-a3: rgba(0, 210, 158, 0.133);
    --mint-a4: rgba(0, 204, 153, 0.216);
    --mint-a5: rgba(0, 192, 145, 0.298);
    --mint-a6: rgba(0, 176, 134, 0.388);
    --mint-a7: rgba(0, 161, 125, 0.506);
    --mint-a8: rgba(0, 158, 127, 0.702);
    --mint-a9: rgba(0, 211, 165, 0.475);
    --mint-a10: rgba(0, 195, 153, 0.51);
    --mint-a11: rgba(0, 119, 99, 0.992);
    --mint-a12: rgba(0, 49, 42, 0.914);

    /* Olive */
    --olive-1: #FCFDFC;
    --olive-2: #F8FAF8;
    --olive-3: #EFF1EF;
    --olive-4: #E7E9E7;
    --olive-5: #DFE2DF;
    --olive-6: #D7DAD7;
    --olive-7: #CCCFCC;
    --olive-8: #B9BCB8;
    --olive-9: #898E87;
    --olive-10: #7F847D;
    --olive-11: #60655F;
    --olive-12: #1D211C;
    --olive-a1: rgba(0, 85, 0, 0.012);
    --olive-a2: rgba(0, 73, 0, 0.027);
    --olive-a3: rgba(0, 32, 0, 0.063);
    --olive-a4: rgba(0, 22, 0, 0.094);
    --olive-a5: rgba(0, 24, 0, 0.125);
    --olive-a6: rgba(0, 20, 0, 0.157);
    --olive-a7: rgba(0, 15, 0, 0.2);
    --olive-a8: rgba(4, 15, 0, 0.278);
    --olive-a9: rgba(5, 15, 0, 0.471);
    --olive-a10: rgba(4, 14, 0, 0.51);
    --olive-a11: rgba(2, 10, 0, 0.627);
    --olive-a12: rgba(1, 6, 0, 0.89);

    /* Orange */
    --orange-1: #FEFCFB;
    --orange-2: #FFF7ED;
    --orange-3: #FFEFD6;
    --orange-4: #FFDFB5;
    --orange-5: #FFD19A;
    --orange-6: #FFC182;
    --orange-7: #F5AE73;
    --orange-8: #EC9455;
    --orange-9: #F76B15;
    --orange-10: #EF5F00;
    --orange-11: #CC4E00;
    --orange-12: #582D1D;
    --orange-a1: rgba(192, 64, 0, 0.016);
    --orange-a2: rgba(255, 142, 0, 0.071);
    --orange-a3: rgba(255, 156, 0, 0.161);
    --orange-a4: rgba(255, 145, 1, 0.29);
    --orange-a5: rgba(255, 139, 0, 0.396);
    --orange-a6: rgba(255, 129, 0, 0.49);
    --orange-a7: rgba(237, 108, 0, 0.549);
    --orange-a8: rgba(227, 95, 0, 0.667);
    --orange-a9: rgba(246, 94, 0, 0.918);
    --orange-a10: #EF5F00;
    --orange-a11: rgba(204, 78, 0, 0.773);
    --orange-a12: rgba(67, 18, 0, 0.886);

    /* Pink */
    --pink-1: #FFFCFE;
    --pink-2: #FEF7FB;
    --pink-3: #FEE9F5;
    --pink-4: #FBDCEF;
    --pink-5: #F6CEE7;
    --pink-6: #EFBFDD;
    --pink-7: #E7ACD0;
    --pink-8: #DD93C2;
    --pink-9: #D6409F;
    --pink-10: #CF3897;
    --pink-11: #C2298A;
    --pink-12: #651249;
    --pink-a1: rgba(255, 0, 170, 0.012);
    --pink-a2: rgba(224, 0, 128, 0.031);
    --pink-a3: rgba(244, 0, 140, 0.086);
    --pink-a4: rgba(226, 0, 139, 0.137);
    --pink-a5: rgba(209, 0, 131, 0.192);
    --pink-a6: rgba(192, 0, 120, 0.251);
    --pink-a7: rgba(182, 0, 111, 0.325);
    --pink-a8: rgba(175, 0, 111, 0.424);
    --pink-a9: rgba(200, 0, 127, 0.749);
    --pink-a10: rgba(194, 0, 122, 0.78);
    --pink-a11: rgba(182, 0, 116, 0.839);
    --pink-a12: rgba(89, 0, 59, 0.929);

    /* Plum */
    --plum-1: #FEFCFF;
    --plum-2: #FDF7FD;
    --plum-3: #FBEBFB;
    --plum-4: #F7DEF8;
    --plum-5: #F2D1F3;
    --plum-6: #E9C2EC;
    --plum-7: #DEADE3;
    --plum-8: #CF91D8;
    --plum-9: #AB4ABA;
    --plum-10: #A144AF;
    --plum-11: #953EA3;
    --plum-12: #53195D;
    --plum-a1: rgba(170, 0, 255, 0.012);
    --plum-a2: rgba(192, 0, 192, 0.031);
    --plum-a3: rgba(204, 0, 204, 0.078);
    --plum-a4: rgba(194, 0, 201, 0.129);
    --plum-a5: rgba(183, 0, 189, 0.18);
    --plum-a6: rgba(164, 0, 176, 0.239);
    --plum-a7: rgba(153, 0, 168, 0.322);
    --plum-a8: rgba(144, 0, 165, 0.431);
    --plum-a9: rgba(137, 0, 158, 0.71);
    --plum-a10: rgba(127, 0, 146, 0.733);
    --plum-a11: rgba(115, 0, 134, 0.757);
    --plum-a12: rgba(64, 0, 75, 0.902);

    /* Purple */
    --purple-1: #FEFCFE;
    --purple-2: #FBF7FE;
    --purple-3: #F7EDFE;
    --purple-4: #F2E2FC;
    --purple-5: #EAD5F9;
    --purple-6: #E0C4F4;
    --purple-7: #D1AFEC;
    --purple-8: #BE93E4;
    --purple-9: #8E4EC6;
    --purple-10: #8347B9;
    --purple-11: #8145B5;
    --purple-12: #402060;
    --purple-a1: rgba(170, 0, 170, 0.012);
    --purple-a2: rgba(128, 0, 224, 0.031);
    --purple-a3: rgba(142, 0, 241, 0.071);
    --purple-a4: rgba(141, 0, 229, 0.114);
    --purple-a5: rgba(128, 0, 219, 0.165);
    --purple-a6: rgba(122, 1, 208, 0.231);
    --purple-a7: rgba(109, 0, 195, 0.314);
    --purple-a8: rgba(102, 0, 192, 0.424);
    --purple-a9: rgba(92, 0, 173, 0.694);
    --purple-a10: rgba(83, 0, 158, 0.722);
    --purple-a11: rgba(82, 0, 154, 0.729);
    --purple-a12: rgba(37, 0, 73, 0.875);

    /* Red */
    --red-1: #FFFCFC;
    --red-2: #FFF7F7;
    --red-3: #FEEBEC;
    --red-4: #FFDBDC;
    --red-5: #FFCDCE;
    --red-6: #FDBDBE;
    --red-7: #F4A9AA;
    --red-8: #EB8E90;
    --red-9: #E5484D;
    --red-10: #DC3E42;
    --red-11: #CE2C31;
    --red-12: #641723;
    --red-a1: rgba(255, 0, 0, 0.012);
    --red-a2: rgba(255, 0, 0, 0.031);
    --red-a3: rgba(243, 0, 13, 0.078);
    --red-a4: rgba(255, 0, 8, 0.141);
    --red-a5: rgba(255, 0, 6, 0.196);
    --red-a6: rgba(248, 0, 4, 0.259);
    --red-a7: rgba(223, 0, 3, 0.337);
    --red-a8: rgba(210, 0, 5, 0.443);
    --red-a9: rgba(219, 0, 7, 0.718);
    --red-a10: rgba(209, 0, 5, 0.757);
    --red-a11: rgba(196, 0, 6, 0.827);
    --red-a12: rgba(85, 0, 13, 0.91);

    /* Ruby */
    --ruby-1: #FFFCFD;
    --ruby-2: #FFF7F9;
    --ruby-3: #FEEFF3;
    --ruby-4: #FFDCE1;
    --ruby-5: #FFCED6;
    --ruby-6: #F8BFC8;
    --ruby-7: #EFACB8;
    --ruby-8: #E592A3;
    --ruby-9: #E54666;
    --ruby-10: #DC3B5D;
    --ruby-11: #CA244D;
    --ruby-12: #64172B;
    --ruby-a1: rgba(255, 0, 85, 0.012);
    --ruby-a2: rgba(255, 0, 32, 0.031);
    --ruby-a3: rgba(243, 0, 37, 0.082);
    --ruby-a4: rgba(255, 0, 37, 0.137);
    --ruby-a5: rgba(255, 0, 42, 0.192);
    --ruby-a6: rgba(228, 0, 36, 0.251);
    --ruby-a7: rgba(206, 0, 37, 0.325);
    --ruby-a8: rgba(195, 0, 40, 0.427);
    --ruby-a9: rgba(219, 0, 44, 0.725);
    --ruby-a10: rgba(210, 0, 44, 0.769);
    --ruby-a11: rgba(193, 0, 48, 0.859);
    --ruby-a12: rgba(85, 0, 22, 0.91);

    /* Sage */
    --sage-1: #FBFDFC;
    --sage-2: #F7F9F8;
    --sage-3: #EEF1F0;
    --sage-4: #E6E9E8;
    --sage-5: #DFE2E0;
    --sage-6: #D7DAD9;
    --sage-7: #CBCFCD;
    --sage-8: #B8BCBA;
    --sage-9: #868E8B;
    --sage-10: #7C8481;
    --sage-11: #5F6563;
    --sage-12: #1A211E;
    --sage-a1: rgba(0, 128, 64, 0.016);
    --sage-a2: rgba(0, 64, 32, 0.031);
    --sage-a3: rgba(0, 45, 30, 0.067);
    --sage-a4: rgba(0, 31, 21, 0.098);
    --sage-a5: rgba(0, 24, 8, 0.125);
    --sage-a6: rgba(0, 20, 13, 0.157);
    --sage-a7: rgba(0, 20, 10, 0.204);
    --sage-a8: rgba(0, 15, 8, 0.278);
    --sage-a9: rgba(0, 17, 11, 0.475);
    --sage-a10: rgba(0, 16, 10, 0.514);
    --sage-a11: rgba(0, 10, 7, 0.627);
    --sage-a12: rgba(0, 8, 5, 0.898);

    /* Sand */
    --sand-1: #FDFDFC;
    --sand-2: #F9F9F8;
    --sand-3: #F1F0EF;
    --sand-4: #E9E8E6;
    --sand-5: #E2E1DE;
    --sand-6: #DAD9D6;
    --sand-7: #CFCECA;
    --sand-8: #BCBBB5;
    --sand-9: #8D8D86;
    --sand-10: #82827C;
    --sand-11: #63635E;
    --sand-12: #21201C;
    --sand-a1: rgba(85, 85, 0, 0.012);
    --sand-a2: rgba(37, 37, 0, 0.027);
    --sand-a3: rgba(32, 16, 0, 0.063);
    --sand-a4: rgba(31, 21, 0, 0.098);
    --sand-a5: rgba(31, 24, 0, 0.129);
    --sand-a6: rgba(25, 19, 0, 0.161);
    --sand-a7: rgba(25, 20, 0, 0.208);
    --sand-a8: rgba(25, 21, 1, 0.29);
    --sand-a9: rgba(15, 15, 0, 0.475);
    --sand-a10: rgba(12, 12, 0, 0.514);
    --sand-a11: rgba(8, 8, 0, 0.631);
    --sand-a12: rgba(6, 5, 0, 0.89);

    /* Sky */
    --sky-1: #F9FEFF;
    --sky-2: #F1FAFD;
    --sky-3: #E1F6FD;
    --sky-4: #D1F0FA;
    --sky-5: #BEE7F5;
    --sky-6: #A9DAED;
    --sky-7: #8DCAE3;
    --sky-8: #60B3D7;
    --sky-9: #7CE2FE;
    --sky-10: #74DAF8;
    --sky-11: #00749E;
    --sky-12: #1D3E56;
    --sky-a1: rgba(0, 213, 255, 0.024);
    --sky-a2: rgba(0, 164, 219, 0.055);
    --sky-a3: rgba(0, 179, 238, 0.118);
    --sky-a4: rgba(0, 172, 228, 0.18);
    --sky-a5: rgba(0, 161, 216, 0.255);
    --sky-a6: rgba(0, 146, 202, 0.337);
    --sky-a7: rgba(0, 137, 193, 0.447);
    --sky-a8: rgba(0, 133, 191, 0.624);
    --sky-a9: rgba(0, 199, 254, 0.514);
    --sky-a10: rgba(0, 188, 243, 0.545);
    --sky-a11: #00749E;
    --sky-a12: rgba(0, 37, 64, 0.886);

    /* Slate */
    --slate-1: #FCFCFD;
    --slate-2: #F9F9FB;
    --slate-3: #F0F0F3;
    --slate-4: #E8E8EC;
    --slate-5: #E0E1E6;
    --slate-6: #D9D9E0;
    --slate-7: #CDCED6;
    --slate-8: #B9BBC6;
    --slate-9: #8B8D98;
    --slate-10: #80838D;
    --slate-11: #60646C;
    --slate-12: #1C2024;
    --slate-a1: rgba(0, 0, 85, 0.012);
    --slate-a2: rgba(0, 0, 85, 0.024);
    --slate-a3: rgba(0, 0, 51, 0.059);
    --slate-a4: rgba(0, 0, 45, 0.09);
    --slate-a5: rgba(0, 9, 50, 0.122);
    --slate-a6: rgba(0, 0, 47, 0.149);
    --slate-a7: rgba(0, 6, 46, 0.196);
    --slate-a8: rgba(0, 8, 48, 0.275);
    --slate-a9: rgba(0, 5, 29, 0.455);
    --slate-a10: rgba(0, 7, 27, 0.498);
    --slate-a11: rgba(0, 7, 20, 0.624);
    --slate-a12: rgba(0, 5, 9, 0.89);

    /* Teal */
    --teal-1: #FAFEFD;
    --teal-2: #F3FBF9;
    --teal-3: #E0F8F3;
    --teal-4: #CCF3EA;
    --teal-5: #B8EAE0;
    --teal-6: #A1DED2;
    --teal-7: #83CDC1;
    --teal-8: #53B9AB;
    --teal-9: #12A594;
    --teal-10: #0D9B8A;
    --teal-11: #008573;
    --teal-12: #0D3D38;
    --teal-a1: rgba(0, 204, 153, 0.02);
    --teal-a2: rgba(0, 170, 128, 0.047);
    --teal-a3: rgba(0, 198, 157, 0.122);
    --teal-a4: rgba(0, 195, 150, 0.2);
    --teal-a5: rgba(0, 180, 144, 0.278);
    --teal-a6: rgba(0, 166, 133, 0.369);
    --teal-a7: rgba(0, 153, 128, 0.486);
    --teal-a8: rgba(0, 151, 131, 0.675);
    --teal-a9: rgba(0, 158, 140, 0.929);
    --teal-a10: rgba(0, 150, 132, 0.949);
    --teal-a11: #008573;
    --teal-a12: rgba(0, 31, 28, 0.925);
    /* Tomato */
    --tomato-1: #FFFCFC;
    --tomato-2: #FFF8F7;
    --tomato-3: #FEEBE7;
    --tomato-4: #FFDCD3;
    --tomato-5: #FFCDC2;
    --tomato-6: #FDBDAF;
    --tomato-7: #F5A898;
    --tomato-8: #EC8E7B;
    --tomato-9: #E54D2E;
    --tomato-10: #DD4425;
    --tomato-11: #D13415;
    --tomato-12: #5C271F;
    --tomato-a1: rgba(255, 0, 0, 0.012);
    --tomato-a2: rgba(255, 32, 0, 0.031);
    --tomato-a3: rgba(245, 43, 0, 0.094);
    --tomato-a4: rgba(255, 53, 0, 0.173);
    --tomato-a5: rgba(255, 46, 0, 0.239);
    --tomato-a6: rgba(249, 45, 0, 0.314);
    --tomato-a7: rgba(231, 40, 0, 0.404);
    --tomato-a8: rgba(219, 37, 0, 0.518);
    --tomato-a9: rgba(223, 38, 0, 0.82);
    --tomato-a10: rgba(215, 36, 0, 0.855);
    --tomato-a11: rgba(205, 34, 0, 0.918);
    --tomato-a12: rgba(70, 9, 0, 0.878);

    /* Violet */
    --violet-1: #FDFCFE;
    --violet-2: #FAF8FF;
    --violet-3: #F4F0FE;
    --violet-4: #EBE4FF;
    --violet-5: #E1D9FF;
    --violet-6: #D4CAFE;
    --violet-7: #C2B5F5;
    --violet-8: #AA99EC;
    --violet-9: #6E56CF;
    --violet-10: #654DC4;
    --violet-11: #6550B9;
    --violet-12: #2F265F;
    --violet-a1: rgba(85, 0, 170, 0.012);
    --violet-a2: rgba(73, 0, 255, 0.027);
    --violet-a3: rgba(68, 0, 238, 0.059);
    --violet-a4: rgba(67, 0, 255, 0.106);
    --violet-a5: rgba(54, 0, 255, 0.149);
    --violet-a6: rgba(49, 0, 251, 0.208);
    --violet-a7: rgba(45, 1, 221, 0.29);
    --violet-a8: rgba(43, 0, 208, 0.4);
    --violet-a9: rgba(36, 0, 183, 0.663);
    --violet-a10: rgba(35, 0, 171, 0.698);
    --violet-a11: rgba(31, 0, 153, 0.686);
    --violet-a12: rgba(11, 0, 67, 0.851);

    /* Yellow */
    --yellow-1: #FDFDF9;
    --yellow-2: #FEFCE9;
    --yellow-3: #FFFAB8;
    --yellow-4: #FFF394;
    --yellow-5: #FFE770;
    --yellow-6: #F3D768;
    --yellow-7: #E4C767;
    --yellow-8: #D5AE39;
    --yellow-9: #FFE629;
    --yellow-10: #FFDC00;
    --yellow-11: #9E6C00;
    --yellow-12: #473B1F;
    --yellow-a1: rgba(170, 170, 0, 0.024);
    --yellow-a2: rgba(244, 221, 0, 0.086);
    --yellow-a3: rgba(255, 238, 0, 0.278);
    --yellow-a4: rgba(255, 227, 1, 0.42);
    --yellow-a5: rgba(255, 213, 0, 0.561);
    --yellow-a6: rgba(235, 188, 0, 0.592);
    --yellow-a7: rgba(210, 161, 0, 0.596);
    --yellow-a8: rgba(201, 151, 0, 0.776);
    --yellow-a9: rgba(255, 225, 0, 0.839);
    --yellow-a10: #FFDC00;
    --yellow-a11: #9E6C00;
    --yellow-a12: rgba(46, 32, 0, 0.878);


    /* --- Semantic Color Aliases (Light Mode) --- */
    --color-background: #fcfcfc;
    --color-surface: #ffffff;
    --color-panel: #ffffff;
    --color-overlay: rgba(0, 8, 48, 0.275);
    --color-shadow: rgba(0, 0, 0, 0.08);
    --text-primary: var(--gray-12);
    --text-secondary: var(--gray-11);

    /* Accent Scale (Blue) - Light Mode */
    --accent-1: var(--blue-1); --accent-2: var(--blue-2); --accent-3: var(--blue-3);
    --accent-4: var(--blue-4); --accent-5: var(--blue-5); --accent-6: var(--blue-6);
    --accent-7: var(--blue-7); --accent-8: var(--blue-8); --accent-9: var(--blue-9);
    --accent-10: var(--blue-10); --accent-11: var(--blue-11); --accent-12: var(--blue-12);
    --accent-a1: var(--blue-a1); --accent-a2: var(--blue-a2); --accent-a3: var(--blue-a3);
    --accent-a4: var(--blue-a4); --accent-a5: var(--blue-a5); --accent-a6: var(--blue-a6);
    --accent-a7: var(--blue-a7); --accent-a8: var(--blue-a8); --accent-a9: var(--blue-a9);
    --accent-a10: var(--blue-a10); --accent-a11: var(--blue-a11); --accent-a12: var(--blue-a12);
    --accent-surface: var(--blue-a2);
    --accent-contrast: #ffffff;

    /* --- Component Constants --- */
    --header-height: 52px;
    --toggle-width: 44px;
    --toggle-height: 24px;
    --toggle-thumb-size: 20px;
    --header-icon-size: 32px;
    --border-subtle: 0.5px;

    /* Semantic Colors (Direct) */
    --header-bg: var(--color-surface);
    --header-border: var(--gray-a4);

    --panel-default: rgba(255, 255, 255, 0.8);
    --colors-neutral-neutral-alpha-3: var(--slate-a3);
    --panel-solid: rgba(255, 255, 255, 1);
    --panel-translucent: rgba(255, 255, 255, 0.8);
    --radius-1: 3px;
    --radius-1-max: 3px;
    --radius-2: 4px;
    --radius-2-max: 4px;
    --radius-3: 6px;
    --radius-3-max: 6px;
    --radius-4: 8px;
    --radius-4-max: 8px;
    --radius-5: 12px;
    --radius-5-max: 12px;
    --radius-6: 16px;
    --radius-6-max: 16px;
    --radius-full: 9999px;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --space-6: 32px;
    --space-7: 40px;
    --space-8: 48px;
    --space-9: 64px;
    --tokens-colors-accent-contrast: #ffffff;
    --tokens-colors-accent-surface: var(--blue-a2);
    --tokens-colors-black-contrast: #000000;
    --tokens-colors-overlay: rgba(0, 8, 48, 0.275);
    --tokens-colors-page-background: rgba(255, 255, 255, 1);
    --tokens-colors-surface: rgba(255, 255, 255, 0.9);
    --tokens-colors-text: rgba(28, 32, 36, 1);
    --tokens-colors-white-contrast: #ffffff;
    --tokens-space-button-height-1: var(--space-5);
    --tokens-space-button-height-2: var(--space-6);
    --tokens-space-button-height-3: var(--space-7);
    --tokens-space-button-height-4: var(--space-8);
    --tokens-space-menu-item-height-1: var(--space-5);
    --tokens-space-menu-item-height-2: var(--space-6);
    --tokens-space-table-cell-min-height-1: 36px;
    --tokens-space-table-cell-min-height-2: 44px;
    --tokens-space-table-cell-min-height-3: var(--space-8);
    --tokens-space-table-cell-padding-1: var(--space-2);
    --tokens-space-table-cell-padding-2: var(--space-3);
    --tokens-space-table-cell-padding-3: var(--space-4);
    --typography-font-family-code: 'Inter Mono', 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
    --typography-font-family-emphasis: 'Georgia', 'Times New Roman', serif;
    --typography-font-family-quote: 'Georgia', 'Garamond', serif;
    --typography-font-family-text: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    --typography-font-size-1: 12px;
    --typography-font-size-2: 14px;
    --typography-font-size-3: 16px;
    --typography-font-size-4: 18px;
    --typography-font-size-5: 20px;
    --typography-font-size-6: 24px;
    --typography-font-size-7: 28px;
    --typography-font-size-8: 35px;
    --typography-font-size-9: 60px;
    --typography-font-weight-bold: Bold;
    --typography-font-weight-light: Light;
    --typography-font-weight-medium: Medium;
    --typography-font-weight-regular: Regular;
    --typography-letter-spacing-1: 0.03999999910593033;
    --typography-letter-spacing-2: 0;
    --typography-letter-spacing-3: 0;
    --typography-letter-spacing-4: -0.03999999910593033;
    --typography-letter-spacing-5: -0.07999999821186066;
    --typography-letter-spacing-6: -0.10000000149011612;
    --typography-letter-spacing-7: -0.11999999731779099;
    --typography-letter-spacing-8: -0.1599999964237213;
    --typography-letter-spacing-9: -0.4000000059604645;
    --typography-line-height-1: 16px;
    --typography-line-height-2: 20px;
    --typography-line-height-3: 24px;
    --typography-line-height-4: 26px;
    --typography-line-height-5: 28px;
    --typography-line-height-6: 30px;
    --typography-line-height-7: 36px;
    --typography-line-height-8: 40px;
    --typography-line-height-9: 60px;

    /* Animation Easing */
    --ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-exit: cubic-bezier(0.4, 0, 1, 1);
    --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

    --font-size-1: 12px; --font-size-2: 14px; --font-size-3: 16px; --font-size-4: 18px;
    --font-size-5: 20px; --font-size-6: 24px; --font-size-7: 28px; --font-size-8: 35px; --font-size-9: 60px;

    --corner-shape: squircle;
    --transition-crisp: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }
`; // End lightModeTokens

const darkModeTokens = `
    /* Gray (Neutral) - Dark Mode Overrides */
    --gray-1: #111111; --gray-2: #191919; --gray-3: #222222; --gray-4: #2a2a2a;
    --gray-5: #313131; --gray-6: #3a3a3a; --gray-7: #484848; --gray-8: #606060;
    --gray-9: #6e6e6e; --gray-10: #7b7b7b; --gray-11: #b4b4b4; --gray-12: #eeeeee;

    /* Gray Alpha - Dark Mode */
    --gray-a1: rgba(255, 255, 255, 0.010); --gray-a2: rgba(255, 255, 255, 0.024); --gray-a3: rgba(255, 255, 255, 0.057);
    --gray-a4: rgba(255, 255, 255, 0.074); --gray-a5: rgba(255, 255, 255, 0.103); --gray-a6: rgba(255, 255, 255, 0.133);
    --gray-a7: rgba(255, 255, 255, 0.176); --gray-a8: rgba(255, 255, 255, 0.255); --gray-a9: rgba(255, 255, 255, 0.420);
    --gray-a10: rgba(255, 255, 255, 0.475); --gray-a11: rgba(255, 255, 255, 0.565); --gray-a12: rgba(255, 255, 255, 0.910);

    /* Semantic Colors - Dark Mode Mapping (Simplified for reliability) */
    /* Success (Green Dark) */
    --green-1: #0e1f17; --green-2: #12281d; --green-3: #163625; --green-4: #19442c;
    --green-5: #1d5234; --green-6: #23633e; --green-7: #2a7949; --green-8: #329257;
    --green-9: #30a46c; --green-10: #36b576; --green-11: #4cc38a; --green-12: #e5fbe9;
    
    /* Error (Red/Crimson Dark) - using Crimson Dark values */
    --crimson-1: #1f1315; --crimson-2: #29141a; --crimson-3: #3c1925; --crimson-4: #4d1c2d;
    --crimson-5: #5d2236; --crimson-6: #702a41; --crimson-7: #8a3551; --crimson-8: #b44065;
    --crimson-9: #e93d82; --crimson-10: #ee5b94; --crimson-11: #f47ea9; --crimson-12: #fee7ef;

    /* Warning (Amber Dark) */
    --amber-1: #16120c; --amber-2: #1d1810; --amber-3: #2d2416; --amber-4: #3c2f1a;
    --amber-5: #4b3b1f; --amber-6: #5b4823; --amber-7: #6e5829; --amber-8: #876d31;
    --amber-9: #ffc53d; --amber-10: #ffd60a; --amber-11: #ffca16; --amber-12: #ffe7b3;

    /* Blue (Accent Dark) */
    --blue-1: #0f1720; --blue-2: #101b26; --blue-3: #11253a; --blue-4: #13304e;
    --blue-5: #153b61; --blue-6: #184a7d; --blue-7: #1c5d9e; --blue-8: #2176c7;
    --blue-9: #0090ff; --blue-10: #52a9ff; --blue-11: #8bc8ff; --blue-12: #eaf6ff;

    /* Semantic Re-map for Dark Mode */
    --color-background: var(--gray-1);
    --color-surface: var(--gray-2);
    --color-panel: var(--gray-2);
    --color-overlay: rgba(0, 0, 0, 0.7);
    --color-shadow: rgba(0, 0, 0, 0.5);
    --text-primary: var(--gray-12);
    --text-secondary: var(--gray-11);

    /* Accent Scale (Blue) - Dark Mode */
    --accent-1: var(--blue-1); --accent-2: var(--blue-2); --accent-3: var(--blue-3);
    --accent-4: var(--blue-4); --accent-5: var(--blue-5); --accent-6: var(--blue-6);
    --accent-7: var(--blue-7); --accent-8: var(--blue-8); --accent-9: var(--blue-9);
    --accent-10: var(--blue-10); --accent-11: var(--blue-11); --accent-12: var(--blue-12);
    --accent-a1: var(--blue-a1); --accent-a2: var(--blue-a2); --accent-a3: var(--blue-a3);
    --accent-a4: var(--blue-a4); --accent-a5: var(--blue-a5); --accent-a6: var(--blue-a6);
    --accent-a7: var(--blue-a7); --accent-a8: var(--blue-a8); --accent-a9: var(--blue-a9);
    --accent-a10: var(--blue-a10); --accent-a11: var(--blue-a11); --accent-a12: var(--blue-a12);
    --accent-surface: rgba(0, 144, 255, 0.15);
    --accent-contrast: #ffffff;

    /* Ensure variables used in Components utilize these overrides */
    --tokens-colors-page-background: var(--gray-1);
    --tokens-colors-surface: var(--gray-2);
    --tokens-colors-text: var(--gray-12);
    --tokens-colors-accent-contrast: #ffffff;
    --tokens-colors-black-contrast: #ffffff;
    --tokens-colors-white-contrast: #000000;

    --panel-default: rgba(30, 30, 30, 0.8);
    --panel-solid: var(--gray-2);
    --panel-translucent: rgba(25, 25, 25, 0.8);
`;

export const cssTokens = lightModeTokens + `
  /* Force light mode when explicitly set */
  [data-theme="light"] {
    color-scheme: light;
  }

  /* Dark Mode Configuration - Only applies when NOT explicitly light */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      ${darkModeTokens}
    }
  }

  /* Attribute-based themes (Fallback/Force) */
  [data-theme="dark"] {
    color-scheme: dark;
    ${darkModeTokens}
  }
`;
