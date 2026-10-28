// Isolated Namespace Configuration to prevent collisions
window.opSphere = {
    viewer: null,
    entities: {},
    currentRig: null,
    hierarchy: {},
    cameraLayoutMode: "list" 
};

// ==========================================
// CORE SYSTEM INITIALIZATION HOOK
// ==========================================
window.initOpSphere = function() {
    if (!opSphere.viewer) {
        if (typeof Cesium === 'undefined') {
            console.error("Cesium library failed to load.");
            return;
        }
        
        // Fetch the token securely from Apps Script properties asynchronously
        google.script.run
            .withSuccessHandler(function(token) {
                if (!token) {
                    console.error("Cesium Access Token not found in Script Properties!");
                    return;
                }
                
                // Set the fetched token
                Cesium.Ion.defaultAccessToken = token;
                
                var container = document.getElementById('cesiumContainer');
                if (!container) return;

                // Initialize with High-Resolution Satellite Maps & World Terrain
                opSphere.viewer = new Cesium.Viewer('cesiumContainer', {
                    imageryProvider: Cesium.createWorldImagery({
                        style: Cesium.IonWorldImageryStyle.AERIAL
                    }),
                    terrainProvider: Cesium.createWorldTerrain(), 
                    animation: false,
                    baseLayerPicker: false,
                    geocoder: false,
                    timeline: false,
                    navigationHelpButton: false,
                    sceneModePicker: false,
                    selectionIndicator: false,
                    infoBox: false,
                    navigationInstructionsInitiallyVisible: false
                });

                // Set viewport framing coordinates
                opSphere.viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(0, 20, 3000000)
                });

                // Now load the rig data layout
                opSphere.loadData();

                // Bind interactive map click handler for selecting rig nodes
                opSphere.viewer.screenSpaceEventHandler.setInputAction(function(event) {
                    opSphere.handleRigClick(event.position);
                }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

                // Bind panel DOM event listeners
                var selectEl = document.getElementById('countrySelect');
                if (selectEl) selectEl.addEventListener('change', opSphere.onCountryChange);

                // Bottom panel tab switching handler
                var tabButtons = document.querySelectorAll('#bottomTabs button');
                for (var i = 0; i < tabButtons.length; i++) {
                    tabButtons[i].addEventListener('click', function() {
                        var allTabs = document.querySelectorAll('#bottomTabs button');
                        for (var j = 0; j < allTabs.length; j++) {
                            allTabs[j].classList.remove('text-blue-400', 'bg-gray-800/30', 'border-blue-500');
                            allTabs[j].classList.add('text-gray-400', 'border-transparent');
                        }
                        
                        this.classList.remove('text-gray-400', 'border-transparent');
                        this.classList.add('text-blue-400', 'bg-gray-800/30', 'border-blue-500');

                        var tabContents = document.querySelectorAll('#opSphereBottomPanel .tab-content');
                        for (var k = 0; k < tabContents.length; k++) {
                            tabContents[k].classList.add('hidden');
                        }
                        
                        var targetId = this.getAttribute('data-tab') + 'Tab';
                        var targetEl = document.getElementById(targetId);
                        if (targetEl) targetEl.classList.remove('hidden');
                    });
                }

                console.log("🚀 OpSphere initialized cleanly with secure properties token!");
            })
            .withFailureHandler(function(error) {
                console.error("Failed to retrieve script properties:", error);
            })
            .getCesiumToken(); // Run backend call
            
    } else {
        opSphere.viewer.resize();
    }
};

opSphere.initGlobe = function() {
    window.initOpSphere();
};

opSphere.loadData = function() {
    google.script.run
        .withSuccessHandler(function(hierarchy) {
            opSphere.hierarchy = hierarchy;
            opSphere.populateCountryDropdown();
            opSphere.loadRigs();
        })
        .withFailureHandler(function(error) {
            console.error('Data acquisition failed:', error);
        })
        .opSphere_getHierarchy();
};

opSphere.populateCountryDropdown = function() {
    var select = document.getElementById('countrySelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select Country</option>';
    
    var countries = Object.keys(opSphere.hierarchy || {});
    for (var i = 0; i < countries.length; i++) {
        var option = document.createElement('option');
        option.value = countries[i];
        option.textContent = countries[i];
        select.appendChild(option);
    }
};

opSphere.loadRigs = function() {
    if (opSphere.viewer.entities) {
        opSphere.viewer.entities.removeAll();
    }
    opSphere.entities = {};

    var countries = Object.keys(opSphere.hierarchy);
    for (var i = 0; i < countries.length; i++) {
        var country = countries[i];
        var sites = Object.keys(opSphere.hierarchy[country]);
        for (var j = 0; j < sites.length; j++) {
            var site = sites[j];
            var rigs = Object.keys(opSphere.hierarchy[country][site]);
            for (var k = 0; k < rigs.length; k++) {
                var rigId = rigs[k];
                var rigData = opSphere.hierarchy[country][site][rigId];
                var entity = opSphere.createRigEntity(country, site, rigId, rigData);
                opSphere.entities[rigId] = entity;
                opSphere.viewer.entities.add(entity);
            }
        }
    }

    opSphere.viewer.zoomTo(opSphere.viewer.entities.values);
};

opSphere.createRigEntity = function(country, site, rigId, rigData) {
    var color = rigData.status === 'active' ? 
        Cesium.Color.GREEN : 
        rigData.status === 'maintenance' ? Cesium.Color.YELLOW : Cesium.Color.RED;

    return new Cesium.Entity({
        name: rigId,
        position: Cesium.Cartesian3.fromDegrees(rigData.lng, rigData.lat),
        point: {
            pixelSize: 10,
            color: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2
        },
        label: {
            text: rigId,
            font: '12pt sans-serif',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -15)
        },
        rigId: rigId,
        country: country,
        site: site,
        status: rigData.status
    });
};

opSphere.onCountryChange = function() {
    var select = document.getElementById('countrySelect');
    if (!select) return;
    var country = select.value;
    
    if (!country) {
        opSphere.viewer.zoomTo(opSphere.viewer.entities.values);
        return;
    }

    var countryEntities = [];
    if (opSphere.hierarchy[country]) {
        var sites = Object.keys(opSphere.hierarchy[country]);
        for (var i = 0; i < sites.length; i++) {
            var site = sites[i];
            var rigs = Object.keys(opSphere.hierarchy[country][site]);
            for (var j = 0; j < rigs.length; j++) {
                var entity = opSphere.entities[rigs[j]];
                if (entity) {
                    countryEntities.push(entity);
                }
            }
        }
    }

    if (countryEntities.length > 0) {
        opSphere.viewer.zoomTo(countryEntities);
    }
};

opSphere.handleRigClick = function(position) {
    var pickedObject = opSphere.viewer.scene.pick(position);
    if (!Cesium.defined(pickedObject) || !Cesium.defined(pickedObject.id)) {
        return;
    }

    var entity = pickedObject.id;
    if (!entity.rigId) return;

    opSphere.loadRigDetails(entity.country, entity.site, entity.rigId);
};

opSphere.loadRigDetails = function(country, site, rigId) {
    google.script.run
        .withSuccessHandler(function(details) {
            opSphere.currentRig = details;
            opSphere.populateControlCenter(details);
        })
        .opSphere_getRigDetails(country, site, rigId);
};

// ==========================================
// SAFELY TOGGLE CAMERA VISUAL LAYOUTS
// ==========================================
opSphere.setCameraLayout = function(mode) {
    opSphere.cameraLayoutMode = mode;
    
    var btnList = document.getElementById('btnViewList');
    var btnGrid1 = document.getElementById('btnViewGrid1');
    var btnGrid2 = document.getElementById('btnViewGrid2');
    
    if (btnList) {
        btnList.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
        btnList.classList.add('text-gray-400', 'hover:text-white');
    }
    if (btnGrid1) {
        btnGrid1.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
        btnGrid1.classList.add('text-gray-400', 'hover:text-white');
    }
    if (btnGrid2) {
        btnGrid2.classList.remove('bg-blue-600', 'text-white', 'shadow-sm');
        btnGrid2.classList.add('text-gray-400', 'hover:text-white');
    }

    switch (mode) {
        case 'list':
            if (btnList) {
                btnList.classList.remove('text-gray-400', 'hover:text-white');
                btnList.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
            }
            break;
        case 'grid1':
            if (btnGrid1) {
                btnGrid1.classList.remove('text-gray-400', 'hover:text-white');
                btnGrid1.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
            }
            break;
        case 'grid2':
            if (btnGrid2) {
                btnGrid2.classList.remove('text-gray-400', 'hover:text-white');
                btnGrid2.classList.add('bg-blue-600', 'text-white', 'shadow-sm');
            }
            break;
    }

    if (opSphere.currentRig) {
        opSphere.renderCameras(opSphere.currentRig.cameras);
    }
};

opSphere.renderCameras = function(cameras) {
    var container = document.getElementById('camerasList');
    if (!container) return;

    container.innerHTML = '';
    
    if (opSphere.cameraLayoutMode === "list") {
        container.setAttribute("class", "flex flex-col space-y-3");
    } else if (opSphere.cameraLayoutMode === "grid1") {
        container.setAttribute("class", "grid grid-cols-1 gap-3");
    } else if (opSphere.cameraLayoutMode === "grid2") {
        container.setAttribute("class", "grid grid-cols-2 gap-2");
    }
    
    if (cameras && cameras.length > 0) {
        for (var i = 0; i < cameras.length; i++) {
            var camera = cameras[i];
            var isOnline = camera.status === 'online';
            var statusColor = isOnline ? 'bg-green-500' : 'bg-red-500';
            var displayId = camera.id;
            
            var card = document.createElement('div');
            card.setAttribute("class", "border border-gray-800 bg-gray-950/80 rounded overflow-hidden flex flex-col transition hover:border-gray-700 shadow");
            
            if (opSphere.cameraLayoutMode === "list") {
                card.innerHTML = [
                    '<div class="flex items-center p-3 space-x-3">',
                        '<div class="w-16 aspect-video bg-black rounded flex items-center justify-center relative border border-gray-800">',
                            '<span class="absolute top-1 left-1 flex h-1.5 w-1.5">',
                                '<span class="animate-ping absolute inline-flex h-full w-full rounded-full ', statusColor, ' opacity-75"></span>',
                                '<span class="relative inline-flex rounded-full h-1.5 w-1.5 ', statusColor, '"></span>',
                            '</span>',
                            '<span class="text-[8px] font-mono text-gray-500">CAM_', displayId, '</span>',
                        '</div>',
                        '<div class="flex-1 min-w-0">',
                            '<h4 class="font-bold text-xs text-gray-200">Camera Feed ', displayId, '</h4>',
                            '<p class="text-[10px] text-gray-400 font-mono mt-0.5">', (isOnline ? 'Active Connection' : 'Signal Lost'), '</p>',
                        '</div>',
                    '</div>'
                ].join('');
            } else {
                card.innerHTML = [
                    '<div class="w-full aspect-video bg-black flex items-center justify-center relative border-b border-gray-900">',
                        '<span class="absolute top-1.5 left-1.5 flex h-1.5 w-1.5">',
                            '<span class="', (isOnline ? 'animate-ping' : ''), ' absolute inline-flex h-full w-full rounded-full ', statusColor, ' opacity-75"></span>',
                            '<span class="relative inline-flex rounded-full h-1.5 w-1.5 ', statusColor, '"></span>',
                        '</span>',
                        '<span class="text-[9px] font-mono ', (isOnline ? 'text-green-400' : 'text-red-500'), '">[FEED_0', displayId, ']</span>',
                    '</div>',
                    '<div class="p-1.5 text-center bg-gray-950">',
                        '<div class="font-bold text-[10px] text-gray-300 truncate">Camera ', displayId, '</div>',
                    '</div>'
                ].join('');
            }
            container.appendChild(card);
        }
    } else {
        container.innerHTML = '<p class="text-gray-500 text-center py-4 font-mono text-xs">No active camera streams configured.</p>';
    }
};

// ==========================================
// DATA INJECTION HANDLERS
// ==========================================
opSphere.populateControlCenter = function(rig) {
    var rightPanelTitle = document.getElementById('rightPanelTitle');
    if (rightPanelTitle) rightPanelTitle.textContent = rig.rigId;
    
    var rightPanelSub = document.getElementById('rightPanelSubtitle');
    if (rightPanelSub) rightPanelSub.textContent = rig.country + " - Sector: " + rig.site;

    opSphere.renderCameras(rig.cameras);

    var panelTitle = document.getElementById('bottomPanelTitle');
    if (panelTitle) panelTitle.textContent = rig.rigId + " // Telemetry Console";

    // Populate Operations Logs Tab
    var opsList = document.getElementById('operationsList');
    if (opsList) {
        opsList.innerHTML = '';
        if (rig.operations && rig.operations.length > 0) {
            for (var i = 0; i < rig.operations.length; i++) {
                var op = rig.operations[i];
                var div = document.createElement('div');
                div.setAttribute("class", "p-2.5 bg-gray-950/60 border border-gray-800 rounded-lg flex flex-col justify-between");
                div.innerHTML = '<div class="text-[10px] text-gray-500 font-mono font-bold">' + op.date + '</div><div class="text-xs text-gray-300 font-medium mt-1">' + op.description + '</div>';
                opsList.appendChild(div);
            }
        } else {
            opsList.innerHTML = '<p class="text-gray-500 text-center col-span-full py-4 text-xs font-mono">No telemetry data recorded.</p>';
        }
    }

    // Populate Personnel Manifests Tab
    var personnelList = document.getElementById('personnelList');
    if (personnelList) {
        personnelList.innerHTML = '';
        if (rig.personnel && rig.personnel.length > 0) {
            for (var j = 0; j < rig.personnel.length; j++) {
                var person = rig.personnel[j];
                var pDiv = document.createElement('div');
                pDiv.setAttribute("class", "flex items-center p-2 bg-gray-950/60 border border-gray-800 rounded-lg");
                pDiv.innerHTML = '<div class="flex-shrink-0 w-7 h-7 bg-blue-600/20 border border-blue-500/30 rounded-full flex items-center justify-center text-blue-400 text-xs font-bold font-mono">' + person.name.charAt(0) + '</div><div class="ml-2.5 min-w-0"><div class="font-bold text-xs text-gray-200 truncate">' + person.name + '</div><div class="text-[9px] text-gray-400 font-mono mt-0.5 truncate">' + person.role + '</div></div>';
                personnelList.appendChild(pDiv);
            }
        } else {
            personnelList.innerHTML = '<p class="text-gray-500 text-center col-span-full py-4 text-xs font-mono">No personnel logged.</p>';
        }
    }

    // Populate Safety Status metrics Tab
    var safetyStatus = document.getElementById('safetyStatus');
    if (safetyStatus) {
        var scoreColor = rig.safety.safetyScore >= 80 ? 'text-green-400' : 'text-red-400';
        var safetyColor = rig.safety.incidents === 0 ? 'text-green-400' : 'text-red-400';
        
        safetyStatus.innerHTML = [
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">',
                '<div class="bg-gray-950/60 p-3 rounded-lg border border-gray-800 text-center">',
                    '<span class="text-[9px] text-gray-500 font-bold uppercase tracking-wider block font-mono">Safety Index</span>',
                    '<span class="text-2xl font-black ', scoreColor, ' font-mono block mt-1">', rig.safety.safetyScore, '%</span>',
                '</div>',
                '<div class="bg-gray-950/60 p-3 rounded-lg border border-gray-800 text-center">',
                    '<span class="text-[9px] text-gray-500 font-bold uppercase tracking-wider block font-mono">Active Incidents</span>',
                    '<span class="text-2xl font-black ', safetyColor, ' font-mono block mt-1">', rig.safety.incidents, '</span>',
                '</div>',
                '<div class="bg-gray-950/60 p-3 rounded-lg border border-gray-800">',
                    '<span class="text-[9px] text-gray-500 font-bold uppercase tracking-wider block font-mono">Last Incident Report</span>',
                    '<p class="text-xs text-gray-300 font-medium mt-1 font-mono">', rig.safety.lastIncident, '</p>',
                '</div>',
            '</div>'
        ].join('');
    }
};

document.addEventListener('DOMContentLoaded', function() {
    opSphere.initGlobe();
});

function onOpSphereModuleOpen() {
    if (!opSphere.viewer) {
        setTimeout(function() {
            opSphere.initGlobe();
        }, 100);
    } else {
        opSphere.viewer.resize();
    }
}

window.opSphereInit = opSphere.initGlobe;
