(function() {
    const F1_MODEL_URL = "https://cdn.3dassets.dev/assets/15248/v1/model.glb";
    const PART_INFO = {
        "front-wing": {
            name: "Front wing",
            category: "AERODYNAMICS / FRONT WING",
            text: "The front wing manages airflow at the nose and creates downforce over the front tyres. Its shape helps set the airflow for the rest of the car.",
            image: "assets/wing.webp",
            imageAlt: "Photo of a Formula 1 front wing and nose"
        },
        "rear-wing": {
            name: "Rear wing & DRS",
            category: "AERODYNAMICS / REAR WING",
            text: "The rear wing adds downforce. In designated zones, DRS opens a flap to reduce drag and help a following car attempt an overtake.",
            image: "assets/rear.webp",
            imageAlt: "Photo of a Formula 1 car viewed from behind, showing the rear wing"
        },
        floor: {
            name: "Floor & diffuser",
            category: "AERODYNAMICS / UNDERFLOOR",
            text: "The shaped floor accelerates air beneath the car. The diffuser expands that airflow at the rear, helping generate downforce.",
            image: "assets/diffeseur.jpg",
            imageAlt: "Photo of the rear diffuser and floor area of a Formula 1 car"
        },
        "power-unit": {
            name: "Hybrid power unit",
            category: "POWER / HYBRID SYSTEM",
            text: "A turbocharged V6 works with electric motor-generators and a battery. The system recovers and redeploys energy around the lap.",
            image: "assets/unit.webp",
            imageAlt: "Photo of a Honda Formula 1 power unit on display"
        },
        tyres: {
            name: "Tyres",
            category: "MECHANICAL GRIP / TYRES",
            text: "The tyres are the car's only contact with the track. Softer compounds are grippier but wear faster; managing temperature and degradation is crucial.",
            image: "assets/tires.webp",
            imageAlt: "Photo of a Pirelli Formula 1 racing tyre"
        }
    };

    const menuToggle = document.querySelector(".menu-toggle");
    const primaryNav = document.querySelector("#primary-nav");

    if (menuToggle && primaryNav) {
        menuToggle.addEventListener("click", () => {
            const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
            menuToggle.setAttribute("aria-expanded", String(!isOpen));
            menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
            primaryNav.classList.toggle("is-open", !isOpen);
        });
    }

    class F1CarScene {
        constructor(canvas) {
            if (!window.THREE) {
                throw new Error("Three.js did not load. Check your internet connection and reload the page.");
            }

            this.canvas = canvas;
            this.container = canvas.closest("[data-car-view]");
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x030405);
            this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
            this.camera.position.set(5.5, 3.8, 4.6);
            this.camera.lookAt(0, 0.55, 0);

            this.scene.add(new THREE.HemisphereLight(0xcad8ff, 0x1b1715, 1.3));
            const keyLight = new THREE.DirectionalLight(0xffffff, 2);
            keyLight.position.set(-4, 8, 5);
            keyLight.castShadow = true;
            this.scene.add(keyLight);
            const rimLight = new THREE.DirectionalLight(0xff493d, 0.9);
            rimLight.position.set(4, 4, -5);
            this.scene.add(rimLight);

            const ground = new THREE.Mesh(
                new THREE.PlaneGeometry(200, 200),
                new THREE.MeshBasicMaterial({ color: 0x030405 })
            );
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = -0.2;
            this.scene.add(ground);

            const shadowPlane = new THREE.Mesh(
                new THREE.PlaneGeometry(200, 200),
                new THREE.ShadowMaterial({ opacity: 0.28 })
            );
            shadowPlane.rotation.x = -Math.PI / 2;
            shadowPlane.position.y = -0.19;
            shadowPlane.receiveShadow = true;
            this.scene.add(shadowPlane);

            const grid = new THREE.GridHelper(16, 32, 0x151719, 0x090b0d);
            grid.position.y = -0.175;
            this.scene.add(grid);

            this.car = new THREE.Group();
            this.scene.add(this.car);
            this.parts = new Map();
            this.disassembleAmount = 0;
            this.disassembleTarget = 0;
            this.aeroActive = false;
            this.drag = null;
            this.dragged = false;
            this.raycaster = new THREE.Raycaster();
            this.pointer = new THREE.Vector2();
            this.clock = new THREE.Clock();
            this.mixer = null;
            this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            this.buildCar();
            this.resize();

            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(canvas.parentElement);
            this.bindPointerControls();
            this.animate();
            this.loadProvidedModel();
        }

        material(color, options) {
            return new THREE.MeshStandardMaterial(Object.assign({
                color,
                roughness: 0.42,
                metalness: 0.42
            }, options || {}));
        }

        mesh(geometry, material, parent, position) {
            const object = new THREE.Mesh(geometry, material);
            object.position.set(position[0], position[1], position[2]);
            object.castShadow = true;
            object.receiveShadow = true;
            parent.add(object);
            return object;
        }

        box(parent, material, position, size, rotation) {
            const object = this.mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material, parent, position);
            if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
            return object;
        }

        addPart(id, separation) {
            const part = new THREE.Group();
            part.userData.partId = id;
            part.userData.homePosition = new THREE.Vector3();
            part.userData.separation = new THREE.Vector3(separation[0], separation[1], separation[2]);
            this.car.add(part);
            this.parts.set(id, part);
            return part;
        }

        buildCar() {
            const red = this.material(0xe83e35, { metalness: 0.52, roughness: 0.32 });
            const redDark = this.material(0x8e201e, { metalness: 0.48 });
            const carbon = this.material(0x24272b, { color: 0x25282d, metalness: 0.62, roughness: 0.38 });
            const carbonEdge = this.material(0x464a50, { metalness: 0.7, roughness: 0.3 });
            const rubber = this.material(0x101113, { color: 0x101113, metalness: 0.02, roughness: 0.86 });
            const alloy = this.material(0xb7bbc1, { metalness: 0.82, roughness: 0.24 });
            const darkGlass = this.material(0x111820, { color: 0x18202b, metalness: 0.65, roughness: 0.18 });

            const floor = this.addPart("floor", [0, -0.9, 0.12]);
            this.box(floor, carbon, [0, 0.13, 0.1], [1.9, 0.13, 3.9]);
            this.box(floor, redDark, [0, 0.18, 1.45], [1.4, 0.08, 0.7]);
            for (const side of[-1, 1]) {
                this.box(floor, carbonEdge, [side * 0.86, 0.18, 0.45], [0.08, 0.08, 2.2]);
            }

            const body = this.addPart("body", [0, 0, 0]);
            this.box(body, red, [0, 0.53, -0.05], [0.82, 0.53, 1.72]);
            this.box(body, redDark, [0, 0.72, 0.97], [0.66, 0.68, 0.86]);
            this.box(body, carbon, [0, 0.88, 0.55], [0.34, 0.19, 0.48]);
            this.box(body, red, [0, 0.62, -1.02], [0.58, 0.24, 1.45], [0.1, 0, 0]);
            this.box(body, redDark, [-0.52, 0.49, 0.24], [0.36, 0.39, 1.04]);
            this.box(body, redDark, [0.52, 0.49, 0.24], [0.36, 0.39, 1.04]);
            const cockpit = this.mesh(new THREE.SphereGeometry(0.33, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), darkGlass, body, [0, 0.86, -0.35]);
            cockpit.scale.set(1, 0.72, 1.42);
            const halo = this.mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 28), alloy, body, [0, 1.03, -0.33]);
            halo.rotation.y = Math.PI / 2;
            this.box(body, carbon, [0, 1.09, -0.32], [0.045, 0.08, 0.55]);

            const frontWing = this.addPart("front-wing", [0, 0.42, -1.1]);
            this.box(frontWing, carbon, [0, 0.16, -2.02], [2.55, 0.09, 0.3]);
            this.frontFlap = new THREE.Group();
            this.frontFlap.position.set(0, 0.22, -1.87);
            frontWing.add(this.frontFlap);
            this.box(this.frontFlap, red, [0, 0, 0], [2.3, 0.055, 0.18]);
            for (const side of[-1, 1]) {
                this.box(frontWing, redDark, [side * 1.2, 0.26, -1.99], [0.09, 0.42, 0.18]);
            }

            const rearWing = this.addPart("rear-wing", [0, 0.9, 0.92]);
            this.box(rearWing, carbon, [0, 0.7, 1.76], [0.12, 0.77, 0.12]);
            this.box(rearWing, carbon, [0, 0.55, 1.76], [1.55, 0.1, 0.22]);
            this.box(rearWing, red, [0, 1.03, 1.79], [2.02, 0.1, 0.3]);
            for (const side of[-1, 1]) {
                this.box(rearWing, redDark, [side * 0.96, 0.86, 1.79], [0.08, 0.42, 0.3]);
            }
            this.rearFlap = new THREE.Group();
            this.rearFlap.position.set(0, 1.1, 1.68);
            rearWing.add(this.rearFlap);
            this.box(this.rearFlap, red, [0, 0, 0.12], [1.9, 0.07, 0.25]);

            const powerUnit = this.addPart("power-unit", [0, 0.82, 0.18]);
            this.box(powerUnit, alloy, [0, 0.65, 1.04], [0.56, 0.42, 0.72]);
            this.box(powerUnit, carbon, [0, 0.88, 1.02], [0.39, 0.15, 0.58]);
            for (const side of[-1, 1]) {
                const pipe = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 12), alloy, powerUnit, [side * 0.31, 0.55, 1.47]);
                pipe.rotation.x = Math.PI / 2;
            }

            const tyres = this.addPart("tyres", [1.15, 0.2, 0]);
            for (const x of[-1.03, 1.03]) {
                for (const z of[-1.25, 1.27]) {
                    const tire = this.mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.29, 32), rubber, tyres, [x, 0.39, z]);
                    tire.rotation.z = Math.PI / 2;
                    const hub = this.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.305, 24), alloy, tyres, [x, 0.39, z]);
                    hub.rotation.z = Math.PI / 2;
                    const hubCap = this.mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.32, 20), red, tyres, [x, 0.39, z]);
                    hubCap.rotation.z = Math.PI / 2;
                }
            }

            for (const part of this.parts.values()) {
                part.userData.homePosition.copy(part.position);
            }
        }

        loadProvidedModel() {
            const badge = this.container.querySelector("[data-model-status]");
            if (!THREE.GLTFLoader) {
                this.useFallback("The GLB loader did not load.");
                return;
            }

            const loader = new THREE.GLTFLoader();
            loader.load(
                F1_MODEL_URL,
                (gltf) => {
                    try {
                        this.installModel(gltf);
                        if (badge) badge.textContent = "CC0 GLB / MODEL LOADED";
                        const status = this.container.querySelector("[data-scene-status]");
                        if (status) status.hidden = true;
                    } catch (error) {
                        this.useFallback(`The GLB could not be prepared: ${error.message}`);
                    }
                },
                (event) => {
                    if (badge && event.total) {
                        badge.textContent = `LOADING CC0 F1 MODEL / ${Math.round((event.loaded / event.total) * 100)}%`;
                    }
                },
                (error) => {
                    this.useFallback(error && error.message ? error.message : "The model download failed.");
                }
            );
        }

        useFallback(reason) {
            console.warn("Using the procedural F1 car fallback:", reason);
            const badge = this.container.querySelector("[data-model-status]");
            if (badge) badge.textContent = "PROCEDURAL FALLBACK";
            const status = this.container.querySelector("[data-scene-status]");
            if (status) {
                status.hidden = false;
                status.textContent = `The provided GLB did not load; the procedural car is active. ${reason}`;
            }
        }

        installModel(gltf) {
            const model = gltf.scene;
            model.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(model);
            if (bounds.isEmpty()) throw new Error("The GLB contains no visible model geometry.");

            const size = bounds.getSize(new THREE.Vector3());
            const center = bounds.getCenter(new THREE.Vector3());
            const scale = 4.3 / Math.max(size.x, size.z);
            const sourceRoot = model.children[0] || model;
            const sourceParts = sourceRoot.children.slice();

            const fallback = {
                car: this.car,
                parts: this.parts,
                frontFlap: this.frontFlap,
                rearFlap: this.rearFlap,
                mixer: this.mixer
            };
            const loadedCar = new THREE.Group();
            this.car = loadedCar;
            this.parts = new Map();
            this.frontFlap = null;
            this.rearFlap = null;
            this.mixer = null;

            try {
                const assembly = new THREE.Group();
                assembly.scale.setScalar(scale);
                assembly.position.set(-center.x * scale, -bounds.min.y * scale - 0.12, -center.z * scale);
                loadedCar.add(assembly);
                assembly.add(model);

                const separations = {
                    body: [0, 0, 0],
                    "front-wing": [0, 0.42, 0.9],
                    "rear-wing": [0, 0.9, -0.9],
                    floor: [0, -0.82, 0],
                    "power-unit": [0, 0.8, -0.25],
                    tyres: [1.08, 0.18, 0]
                };
                const groups = new Map();
                Object.keys(separations).forEach((id) => {
                    const group = new THREE.Group();
                    group.userData.partId = id;
                    group.userData.homePosition = new THREE.Vector3();
                    group.userData.separation = new THREE.Vector3(...separations[id]);
                    sourceRoot.add(group);
                    groups.set(id, group);
                    this.parts.set(id, group);
                });

                for (const part of sourceParts) {
                    sourceRoot.remove(part);
                    const id = this.classifyModelPart(part);
                    groups.get(id).add(part);
                }

                model.updateMatrixWorld(true);
                for (const [id, group] of groups) {
                    if (id !== "body") {
                        this.addModelPartDetail(id, group, this.containsModelMesh(group));
                    }
                    this.addPartHitbox(id, group);
                    group.userData.homePosition.copy(group.position);
                }

                model.traverse((object) => {
                    if (object.isMesh) {
                        object.castShadow = true;
                        object.receiveShadow = true;
                    }
                });

                if (gltf.animations && gltf.animations.length) {
                    this.mixer = new THREE.AnimationMixer(model);
                    gltf.animations.forEach((clip) => this.mixer.clipAction(clip).play());
                }
            } catch (error) {
                this.scene.remove(loadedCar);
                this.disposeObject(loadedCar);
                this.car = fallback.car;
                this.parts = fallback.parts;
                this.frontFlap = fallback.frontFlap;
                this.rearFlap = fallback.rearFlap;
                this.mixer = fallback.mixer;
                throw error;
            }

            this.scene.add(loadedCar);
            this.scene.remove(fallback.car);
            this.disposeObject(fallback.car);
        }

        classifyModelPart(object) {
            if (/^wheel/i.test(object.name)) return "tyres";

            const bounds = new THREE.Box3().setFromObject(object);
            const size = bounds.getSize(new THREE.Vector3());
            const center = bounds.getCenter(new THREE.Vector3());
            if (size.x > 1.5 && size.x > size.y * 3 && size.x > size.z * 3) {
                return center.z >= 0 ? "front-wing" : "rear-wing";
            }
            if (size.y < 0.28 && size.z > 1.5 && center.y < 0.55) return "floor";
            if (center.z < -0.45 && center.y < 0.9) return "power-unit";
            return "body";
        }

        containsModelMesh(group) {
            let found = false;
            group.traverse((object) => {
                if (object.isMesh && object.userData.isPartHitbox !== true) found = true;
            });
            return found;
        }

        addPartHitbox(id, group) {
            const hitboxes = {
                "front-wing": { position: [0, 0.42, 1.78], size: [2.3, 0.34, 0.45] },
                "rear-wing": { position: [0, 0.95, -1.72], size: [2.25, 0.58, 0.4] },
                floor: { position: [0, 0.18, 0], size: [1.8, 0.3, 2.9] },
                "power-unit": { position: [0, 0.65, -0.38], size: [1.15, 0.9, 1.45] }
            };
            if (id === "body") return;
            if (id === "tyres") return;
            const hitbox = hitboxes[id];
            const material = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0,
                colorWrite: false,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            const mesh = this.mesh(new THREE.BoxGeometry(...hitbox.size), material, group, hitbox.position);
            mesh.userData.isPartHitbox = true;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
        }

        addModelPartDetail(id, group, hasModelMesh) {
            const carbon = this.material(0x24272b, { metalness: 0.62, roughness: 0.38 });
            const red = this.material(0xe83e35, { metalness: 0.52, roughness: 0.32 });
            if (id === "front-wing") {
                if (!hasModelMesh) this.box(group, carbon, [0, 0.28, 1.78], [2.3, 0.09, 0.3]);
                this.frontFlap = new THREE.Group();
                this.frontFlap.position.set(0, 0.35, 1.66);
                group.add(this.frontFlap);
                this.box(this.frontFlap, red, [0, 0, 0], [hasModelMesh ? 1.7 : 2.05, 0.06, 0.18]);
            } else if (id === "rear-wing") {
                if (!hasModelMesh) {
                    this.box(group, carbon, [0, 0.7, -1.78], [0.12, 0.7, 0.12]);
                    this.box(group, carbon, [0, 0.55, -1.78], [1.6, 0.1, 0.22]);
                    this.box(group, red, [0, 0.94, -1.78], [2.05, 0.1, 0.28]);
                }
                this.rearFlap = new THREE.Group();
                this.rearFlap.position.set(0, 1.02, -1.66);
                group.add(this.rearFlap);
                this.box(this.rearFlap, red, [0, 0, 0], [hasModelMesh ? 1.65 : 1.9, 0.06, 0.22]);
            } else if (id === "floor") {
                if (!hasModelMesh) this.box(group, carbon, [0, 0.16, 0], [1.7, 0.09, 3.25]);
            } else if (id === "power-unit") {
                if (!hasModelMesh) {
                    this.box(group, carbon, [0, 0.62, -0.35], [0.82, 0.58, 1.1]);
                    this.box(group, red, [0, 0.94, -0.43], [0.46, 0.12, 0.64]);
                }
            }
        }

        disposeObject(root) {
            root.traverse((object) => {
                if (!object.isMesh) return;
                object.geometry.dispose();
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach((material) => material.dispose());
            });
        }

        bindPointerControls() {
            this.canvas.addEventListener("pointerdown", (event) => {
                if (event.button !== 0) return;
                this.drag = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY };
                this.dragged = false;
                this.canvas.setPointerCapture(event.pointerId);
            });

            this.canvas.addEventListener("pointermove", (event) => {
                if (!this.drag) {
                    this.canvas.style.cursor = this.hitTest(event.clientX, event.clientY) ? "pointer" : "grab";
                    return;
                }
                const dx = event.clientX - this.drag.lastX;
                const dy = event.clientY - this.drag.lastY;
                if (Math.abs(event.clientX - this.drag.x) + Math.abs(event.clientY - this.drag.y) > 5) this.dragged = true;
                if (this.dragged) {
                    this.car.rotation.y += dx * 0.009;
                    this.car.rotation.x = THREE.MathUtils.clamp(this.car.rotation.x + dy * 0.006, -0.55, 0.55);
                }
                this.drag.lastX = event.clientX;
                this.drag.lastY = event.clientY;
            });

            this.canvas.addEventListener("pointerup", (event) => {
                if (!this.drag) return;
                if (!this.dragged) this.selectAt(event.clientX, event.clientY);
                this.drag = null;
                this.canvas.style.cursor = "grab";
            });

            this.canvas.addEventListener("pointercancel", () => { this.drag = null; });
            this.canvas.addEventListener("wheel", (event) => {
                event.preventDefault();
                this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z + event.deltaY * 0.004, 5.2, 11);
            }, { passive: false });
        }

        hitTest(clientX, clientY) {
            const bounds = this.canvas.getBoundingClientRect();
            this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
            this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const intersections = this.raycaster.intersectObject(this.car, true);
            return intersections.some((hit) => this.findPart(hit.object));
        }

        findPart(object) {
            let candidate = object;
            while (candidate && candidate !== this.car) {
                if (candidate.userData.partId && candidate.userData.partId !== "body") return candidate.userData.partId;
                candidate = candidate.parent;
            }
            return null;
        }

        selectAt(clientX, clientY) {
            const bounds = this.canvas.getBoundingClientRect();
            this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
            this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const intersections = this.raycaster.intersectObject(this.car, true);
            for (const hit of intersections) {
                const id = this.findPart(hit.object);
                if (id) {
                    this.selectPart(id);
                    return;
                }
            }
        }

        selectPart(id) {
            if (!PART_INFO[id]) return;
            for (const [partId, group] of this.parts) {
                group.traverse((object) => {
                    if (!object.isMesh) return;
                    const materials = Array.isArray(object.material) ? object.material : [object.material];
                    for (const material of materials) {
                        if (!material.emissive) continue;
                        if (material.userData.baseEmissive === undefined) material.userData.baseEmissive = material.emissive.getHex();
                        material.emissive.setHex(partId === id ? 0x4a130f : material.userData.baseEmissive);
                    }
                });
            }
            this.showPartInfo(id);
        }

        showPartInfo(id) {
            const info = PART_INFO[id];
            const view = this.canvas.closest(".tech-explorer") || this.container;
            if (!view) return;
            const callout = view.querySelector("[data-part-callout]");
            if (callout) {
                callout.querySelector(".card-team").textContent = info.category;
                callout.querySelector("h2").textContent = info.name;
                callout.querySelector("p:last-child").textContent = info.text;
                const partImage = callout.querySelector("[data-part-image]");
                if (partImage) {
                    partImage.src = info.image;
                    partImage.alt = info.imageAlt;
                }
            }
            const homeCallout = view.querySelector("[data-model-callout]");
            if (homeCallout) homeCallout.textContent = `${info.name} — ${info.text}`;
            document.querySelectorAll("[data-select-part]").forEach((button) => {
                button.classList.toggle("is-selected", button.dataset.selectPart === id);
                button.setAttribute("aria-pressed", String(button.dataset.selectPart === id));
            });
        }

        toggleDisassembly() {
            this.disassembleTarget = this.disassembleTarget === 0 ? 1 : 0;
            return this.disassembleTarget === 1;
        }

        toggleAero() {
            this.aeroActive = !this.aeroActive;
            return this.aeroActive;
        }

        resize() {
            const width = Math.max(1, this.canvas.clientWidth);
            const height = Math.max(1, this.canvas.clientHeight);
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }

        animate() {
            requestAnimationFrame(() => this.animate());
            const time = performance.now() * 0.001;
            const delta = this.clock.getDelta();
            if (this.mixer) this.mixer.update(delta);
            if (!this.drag && !this.reduceMotion) this.car.rotation.y += 0.0017;
            this.disassembleAmount += (this.disassembleTarget - this.disassembleAmount) * 0.075;

            for (const part of this.parts.values()) {
                const home = part.userData.homePosition;
                const separation = part.userData.separation;
                part.position.set(
                    home.x + separation.x * this.disassembleAmount,
                    home.y + separation.y * this.disassembleAmount,
                    home.z + separation.z * this.disassembleAmount
                );
            }

            const aero = this.aeroActive && !this.reduceMotion ? 0.2 + Math.sin(time * 2.1) * 0.1 : 0;
            if (this.frontFlap) this.frontFlap.rotation.x = aero;
            if (this.rearFlap) this.rearFlap.rotation.x = -aero * 1.4;
            this.renderer.render(this.scene, this.camera);
        }
    }

    const scenes = new Map();
    document.querySelectorAll("[data-f1-scene]").forEach((canvas) => {
        const status = canvas.parentElement.querySelector("[data-scene-status]");
        try {
            scenes.set(canvas, new F1CarScene(canvas));
        } catch (error) {
            console.error("Could not start the Three.js car viewer:", error);
            canvas.hidden = true;
            if (status) {
                status.hidden = false;
                status.textContent = `3D viewer unavailable: ${error.message}`;
            }
        }
    });

    document.querySelectorAll("[data-f1-action]").forEach((button) => {
        button.addEventListener("click", () => {
            const view = button.closest("[data-car-view], .tech-explorer");
            const canvas = view && view.querySelector("[data-f1-scene]");
            const scene = canvas && scenes.get(canvas);
            if (!scene) return;
            const active = button.dataset.f1Action === "disassemble" ?
                scene.toggleDisassembly() :
                scene.toggleAero();
            button.setAttribute("aria-pressed", String(active));
            button.classList.toggle("is-active", active);
            if (button.dataset.f1Action === "disassemble") {
                button.textContent = active ? "Reassemble" : "Disassemble";
            }
        });
    });

    document.querySelectorAll("[data-select-part]").forEach((button) => {
        button.addEventListener("click", () => {
            const canvas = document.querySelector("[data-f1-scene]");
            const scene = canvas && scenes.get(canvas);
            if (scene) scene.selectPart(button.dataset.selectPart);
        });
    });

    const driverGrid = document.querySelector("[data-driver-grid]");
    const apiStatus = document.querySelector("[data-api-status]");
    const searchInput = document.querySelector("#driver-search");
    const retryButton = document.querySelector("[data-api-retry]");
    const emptyState = document.querySelector("[data-empty-state]");

    if (driverGrid && apiStatus && window.F1Api) {
        const properCase = (value) => value.toLocaleLowerCase().replace(/(^|[\s'-])(\S)/g, (match, prefix, letter) => prefix + letter.toLocaleUpperCase());
        const initialsFor = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        const validPhotoUrl = (value) => {
            if (!value) return "";
            try {
                const url = new URL(value);
                return url.protocol === "https:" ? url.href : "";
            } catch {
                return "";
            }
        };

        const renderDrivers = (drivers) => {
            const uniqueDrivers = new Map();
            drivers.forEach((driver) => {
                const key = String(driver.driver_number || driver.name_acronym || driver.full_name || "");
                if (key && !uniqueDrivers.has(key)) uniqueDrivers.set(key, driver);
            });
            const sortedDrivers = Array.from(uniqueDrivers.values()).sort((a, b) => Number(a.driver_number) - Number(b.driver_number));
            driverGrid.replaceChildren();

            sortedDrivers.forEach((driver) => {
                const apiName = driver.first_name && driver.last_name ?
                    `${driver.first_name} ${driver.last_name}` :
                    driver.full_name || driver.broadcast_name || `Driver ${driver.driver_number || ""}`.trim();
                const name = properCase(apiName);
                const team = driver.team_name || "Formula 1";
                const card = document.createElement("article");
                card.className = "driver-card";
                card.dataset.search = `${name} ${team} ${driver.country_code || ""}`.toLowerCase();
                if (/^[0-9a-f]{6}$/i.test(driver.team_colour || "")) {
                    card.style.setProperty("--team-color", `#${driver.team_colour}`);
                }

                const photo = document.createElement("div");
                photo.className = "driver-photo";
                const initials = document.createElement("span");
                initials.className = "photo-initials";
                initials.textContent = initialsFor(name);
                initials.setAttribute("aria-hidden", "true");
                photo.append(initials);

                const photoUrl = validPhotoUrl(driver.headshot_url);
                if (photoUrl) {
                    const image = document.createElement("img");
                    image.src = photoUrl;
                    image.alt = "";
                    image.loading = "lazy";
                    image.onerror = () => image.remove();
                    photo.append(image);
                }

                const info = document.createElement("div");
                info.className = "driver-info";
                const teamLabel = document.createElement("p");
                teamLabel.className = "card-team";
                teamLabel.textContent = team;
                const heading = document.createElement("h2");
                heading.textContent = name;
                const meta = document.createElement("p");
                meta.className = "driver-nationality";
                const number = driver.driver_number ? `#${driver.driver_number}` : "";
                const country = driver.country_code || "";
                meta.textContent = [number, country].filter(Boolean).join(" · ") || "F1 driver";
                info.append(teamLabel, heading, meta);
                card.append(photo, info);
                driverGrid.append(card);
            });

            if (sortedDrivers.length === 0) {
                throw new Error("OpenF1 returned no usable driver records.");
            }
            apiStatus.textContent = `${sortedDrivers.length} drivers loaded from OpenF1.`;
            apiStatus.classList.remove("is-error");
            if (searchInput) searchInput.dispatchEvent(new Event("input"));
        };

        const loadDrivers = async() => {
            apiStatus.textContent = "Loading the latest driver list from OpenF1…";
            apiStatus.classList.remove("is-error");
            if (retryButton) retryButton.hidden = true;
            try {
                const drivers = await window.F1Api.fetchDrivers();
                renderDrivers(drivers);
            } catch (error) {
                console.error("Could not load drivers from OpenF1:", error);
                apiStatus.textContent = `Could not load driver data: ${error.message}`;
                apiStatus.classList.add("is-error");
                if (retryButton) retryButton.hidden = false;
            }
        };

        if (searchInput) {
            searchInput.addEventListener("input", () => {
                const query = searchInput.value.trim().toLowerCase();
                let visibleCount = 0;
                driverGrid.querySelectorAll(".driver-card").forEach((card) => {
                    const matches = card.dataset.search.includes(query);
                    card.hidden = !matches;
                    if (matches) visibleCount += 1;
                });
                if (emptyState) emptyState.hidden = visibleCount !== 0;
            });
        }
        if (retryButton) retryButton.addEventListener("click", loadDrivers);
        loadDrivers();
    }
})();